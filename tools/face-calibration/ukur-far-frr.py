"""Ukur FAR/FRR pada AMBANG OPERASIONAL yang benar-benar dipakai aplikasi.

calibrate.py menjawab "preprocessing mana yang terbaik" dan melaporkan EER
(titik tempat FAR = FRR). Skripsi butuh angka yang berbeda: berapa FAR dan
FRR pada ambang yang SUNGGUH dipasang di FACE_MATCH_THRESHOLD, memakai
agregasi median terhadap N wajah terdaftar - persis jalur putusan di
utils/faceEnrollment.ts + utils/verificationAgent.ts.

Protokol (leave-one-identity-out, banyak pengulangan acak):
  - setiap identitas bergiliran menjadi "pemilik akun";
  - `--enroll` foto miliknya dipilih acak sebagai wajah terdaftar;
  - sisa fotonya menjadi percobaan GENUINE (harusnya diterima);
  - seluruh foto identitas lain menjadi percobaan IMPOSTOR (harusnya ditolak);
  - diulang `--repeat` kali per identitas dengan pemilihan acak berbeda.

Ini memakai SEMUA identitas sebagai pemilik, bukan hanya "saya", sehingga
jumlah percobaan genuine jauh lebih banyak daripada aggregation_study().

HTER (half total error rate) = (FAR + FRR) / 2, dilaporkan di samping
akurasi. Akurasi didominasi kelas impostor (jumlahnya 14 kali genuine),
sedangkan HTER memberi bobot sama pada kedua jenis kesalahan.

PEMBETULAN 2026-11-05: versi sebelumnya memotong foto uji dengan
`E[idx[args.enroll] :]` - irisan dari POSISI ACAK di urutan asli, bukan sisa
foto yang tidak terpilih. Jumlah percobaan genuine menjadi acak (6.999,
seharusnya 200 x 36 = 7.200) dan foto terdaftar dapat ikut diuji terhadap
dirinya sendiri. Seluruh angka genuine/FRR/d'/EER sebelum tanggal ini keliru;
angka impostor/FAR tidak terdampak.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from calibrate import Detector, Embedder, Variant, load_dataset, preprocess, d_prime, eer_and_threshold

# Konfigurasi yang MENANG di sapuan 80 varian dan yang dipakai aplikasi:
# (x-128)/128, margin 0.9, alignment kanonik, RGB, tanpa mirror.
APP_VARIANT = Variant("(x-128)/128", 0.9, True, "RGB", False)


def median_scores(probes: np.ndarray, enroll: np.ndarray) -> np.ndarray:
    """Skor putusan aplikasi: median kemiripan terhadap seluruh wajah terdaftar."""
    return np.median(probes @ enroll.T, axis=1)


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--photos", type=Path, default=here / "photos")
    ap.add_argument("--model", type=Path, default=here.parent.parent / "assets" / "models" / "mobilefacenet.tflite")
    ap.add_argument("--detector", type=Path, default=here / "blaze_face_short_range.tflite")
    ap.add_argument("--enroll", type=int, default=3)
    ap.add_argument("--repeat", type=int, default=200)
    ap.add_argument("--thresholds", type=float, nargs="+",
                    default=[0.47, 0.50, 0.55, 0.60, 0.65, 0.673, 0.70, 0.75],
                    help="ambang yang dilaporkan; rincian per identitas memakai 0.673 bila ada, "
                         "kalau tidak memakai ambang terakhir")
    ap.add_argument("--seed", type=int, default=20260919)
    ap.add_argument("--buang-pencilan", action="store_true",
                    help="buang foto yang median kemiripannya <0.45 terhadap foto lain dari orang yang sama "
                         "(deteksi/alignment meleset) - proksi untuk quality gate di aplikasi")
    args = ap.parse_args()

    print(f"Memuat foto dari {args.photos} ...")
    data = load_dataset(args.photos, Detector(args.detector))
    embedder = Embedder(args.model)

    embeds: dict[str, np.ndarray] = {}
    for person, items in data.items():
        embeds[person] = np.stack([embedder.embed(preprocess(img, geom, APP_VARIANT)) for _, img, geom in items])

    if args.buang_pencilan:
        for person, E in list(embeds.items()):
            S = E @ E.T
            np.fill_diagonal(S, np.nan)
            med = np.nanmedian(S, axis=1)
            keep = med >= 0.45
            if not keep.all():
                print(f"  buang {int((~keep).sum())} foto pencilan dari {person} "
                      f"(median diri {np.round(med[~keep], 3).tolist()})")
                embeds[person] = E[keep]

    n_photos = sum(len(v) for v in embeds.values())
    print(f"{n_photos} foto dari {len(embeds)} identitas, konfigurasi: {APP_VARIANT.label()}")
    print(f"Enrollment {args.enroll} foto, {args.repeat} pengulangan acak per identitas.\n")

    rng = np.random.default_rng(args.seed)
    gen_all: list[np.ndarray] = []
    imp_all: list[np.ndarray] = []
    per_owner: dict[str, tuple[list[float], list[float]]] = {}

    for owner, E in embeds.items():
        if len(E) < args.enroll + 1:
            print(f"  (lewati {owner}: hanya {len(E)} foto)")
            continue
        others = np.concatenate([v for k, v in embeds.items() if k != owner])
        g_o: list[np.ndarray] = []
        i_o: list[np.ndarray] = []
        for _ in range(args.repeat):
            idx = rng.permutation(len(E))
            enroll, probes = E[idx[: args.enroll]], E[idx[args.enroll :]]
            g_o.append(median_scores(probes, enroll))
            i_o.append(median_scores(others, enroll))
        g, i = np.concatenate(g_o), np.concatenate(i_o)
        gen_all.append(g)
        imp_all.append(i)
        per_owner[owner] = (g, i)

    gen, imp = np.concatenate(gen_all), np.concatenate(imp_all)

    print("=" * 74)
    print(f"DISTRIBUSI SKOR (median-of-{args.enroll})")
    print("=" * 74)
    print(f"  genuine  : n={len(gen):6d}  rata2 {gen.mean():.4f}  min {gen.min():.4f}  p1 {np.percentile(gen,1):.4f}")
    print(f"  impostor : n={len(imp):6d}  rata2 {imp.mean():.4f}  maks {imp.max():.4f}  p99 {np.percentile(imp,99):.4f}")
    eer, t_eer = eer_and_threshold(gen, imp)
    print(f"  d-prime  : {d_prime(gen, imp):.3f}     EER {eer:.4%} pada ambang {t_eer:.3f}")

    print("\n" + "=" * 74)
    print("FAR / FRR PADA AMBANG OPERASIONAL")
    print("=" * 74)
    print(f"{'ambang':>8} {'FAR':>10} {'FRR':>10} {'HTER':>10} {'akurasi':>10}   "
          f"{'(impostor lolos)':>18} {'(genuine ditolak)':>18}")
    for t in args.thresholds:
        fa, fr = int((imp >= t).sum()), int((gen < t).sum())
        far, frr = fa / len(imp), fr / len(gen)
        acc = (len(gen) - fr + len(imp) - fa) / (len(gen) + len(imp))
        print(f"{t:>8.3f} {far:>10.4%} {frr:>10.4%} {(far + frr) / 2:>10.4%} {acc:>10.4%}   "
              f"{f'{fa}/{len(imp)}':>18} {f'{fr}/{len(gen)}':>18}")

    t = 0.673 if 0.673 in args.thresholds else args.thresholds[-1]
    print("\n" + "=" * 74)
    print(f"RINCIAN PER IDENTITAS pada ambang {t:.3f}")
    print("=" * 74)
    print(f"{'identitas':<14} {'n foto':>7} {'n genuine':>10} {'gen rata2':>10} {'gen min':>9} {'FRR':>9} "
          f"{'imp maks':>9} {'FAR':>9}")
    for owner, (g, i) in sorted(per_owner.items()):
        print(f"{owner:<14} {len(embeds[owner]):>7} {len(g):>10} {g.mean():>10.4f} {g.min():>9.4f} "
              f"{(g < t).mean():>9.4%} {i.max():>9.4f} {(i >= t).mean():>9.4%}")


if __name__ == "__main__":
    main()
