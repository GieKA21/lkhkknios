"""Evaluasi TIDAK SIRKULAR: ambang ditetapkan pada subset kalibrasi, diuji
pada subset identitas yang DITAHAN (held-out).

Masalah yang dipecahkan: menetapkan ambang lalu mengukur FAR/FRR pada data
yang sama bersifat sirkular. Skrip ini memisahkan keduanya berdasarkan
IDENTITAS (bukan sekadar foto), lalu memutar pemisahan itu ke seluruh
kombinasi supaya hasilnya tidak bergantung pada satu pembagian yang kebetulan
menguntungkan.

Untuk tiap lipatan (fold):
  1. identitas dibagi: `--n-uji` identitas ditahan, sisanya jadi kalibrasi;
  2. pada subset KALIBRASI dicari ambang EER (agregasi median-of-N);
  3. ambang itu DIKUNCI, lalu FAR/FRR dihitung pada subset UJI yang
     identitasnya belum pernah dilihat saat penetapan ambang.
"""

from __future__ import annotations

import argparse
from itertools import combinations
from pathlib import Path

import numpy as np

from calibrate import Detector, Embedder, Variant, load_dataset, preprocess, eer_and_threshold

APP_VARIANT = Variant("(x-128)/128", 0.9, True, "RGB", False)


def skor_subset(embeds, ids, n_enroll, repeat, rng):
    """Skor genuine & impostor DI DALAM satu subset identitas."""
    gen, imp = [], []
    for owner in ids:
        E = embeds[owner]
        if len(E) < n_enroll + 1:
            continue
        others = [embeds[k] for k in ids if k != owner]
        if not others:
            continue
        O = np.concatenate(others)
        for _ in range(repeat):
            idx = rng.permutation(len(E))
            enroll, probes = E[idx[:n_enroll]], E[idx[n_enroll:]]
            gen.append(np.median(probes @ enroll.T, axis=1))
            imp.append(np.median(O @ enroll.T, axis=1))
    return np.concatenate(gen), np.concatenate(imp)


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--photos", type=Path, default=here / "photos")
    ap.add_argument("--model", type=Path, default=here.parent.parent / "assets" / "models" / "mobilefacenet.tflite")
    ap.add_argument("--detector", type=Path, default=here / "blaze_face_short_range.tflite")
    ap.add_argument("--enroll", type=int, default=3)
    ap.add_argument("--repeat", type=int, default=50)
    ap.add_argument("--n-uji", type=int, default=4, help="jumlah identitas yang ditahan per lipatan")
    ap.add_argument("--ambang-aplikasi", type=float, default=0.673)
    ap.add_argument("--seed", type=int, default=20260922)
    args = ap.parse_args()

    data = load_dataset(args.photos, Detector(args.detector))
    emb = Embedder(args.model)
    embeds = {p: np.stack([emb.embed(preprocess(i, g, APP_VARIANT)) for _, i, g in items])
              for p, items in data.items()}
    ids = sorted(embeds)
    print(f"\n{sum(len(v) for v in embeds.values())} foto, {len(ids)} identitas.")

    folds = list(combinations(ids, args.n_uji))
    print(f"Lipatan: seluruh {len(folds)} kombinasi penahanan {args.n_uji} identitas "
          f"({len(ids) - args.n_uji} identitas untuk kalibrasi).")
    print(f"Enrollment {args.enroll} foto, {args.repeat} pengulangan acak per identitas per lipatan.\n")

    rng = np.random.default_rng(args.seed)
    thr, far, frr, acc, far_f, frr_f, acc_f = [], [], [], [], [], [], []

    for test_ids in folds:
        cal_ids = [i for i in ids if i not in test_ids]
        g_c, i_c = skor_subset(embeds, cal_ids, args.enroll, args.repeat, rng)
        _, t = eer_and_threshold(g_c, i_c)          # ambang dari subset KALIBRASI
        g_t, i_t = skor_subset(embeds, list(test_ids), args.enroll, args.repeat, rng)

        for T, (fa, fr, ac) in ((t, (far, frr, acc)), (args.ambang_aplikasi, (far_f, frr_f, acc_f))):
            a, r = float((i_t >= T).mean()), float((g_t < T).mean())
            fa.append(a); fr.append(r)
            ac.append((len(g_t) * (1 - r) + len(i_t) * (1 - a)) / (len(g_t) + len(i_t)))
        thr.append(t)

    def ring(nama, v):
        v = np.array(v)
        print(f"  {nama:<28} {v.mean():>9.4f}  (sd {v.std():.4f}, min {v.min():.4f}, maks {v.max():.4f})")

    print("=" * 74)
    print("A. AMBANG DITETAPKAN DARI SUBSET KALIBRASI, DIUJI PADA IDENTITAS DITAHAN")
    print("=" * 74)
    ring("ambang EER (dipelajari)", thr)
    ring("FAR pada identitas ditahan", far)
    ring("FRR pada identitas ditahan", frr)
    ring("HTER = (FAR + FRR) / 2", (np.array(far) + np.array(frr)) / 2)
    ring("akurasi", acc)

    print("\n" + "=" * 74)
    print(f"B. AMBANG APLIKASI {args.ambang_aplikasi} DIKUNCI, DIUJI PADA IDENTITAS DITAHAN")
    print("=" * 74)
    ring("FAR pada identitas ditahan", far_f)
    ring("FRR pada identitas ditahan", frr_f)
    ring("HTER = (FAR + FRR) / 2", (np.array(far_f) + np.array(frr_f)) / 2)
    ring("akurasi", acc_f)
    print(f"\n  lipatan dengan FAR > 0 pada ambang aplikasi: {int((np.array(far_f) > 0).sum())} dari {len(folds)}")


if __name__ == "__main__":
    main()
