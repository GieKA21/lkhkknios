"""Uji ambang operasional (0,673) terhadap dataset wajah publik LFW.

Pertanyaannya: apakah FAR 0,00 % pada 9 identitas tetap 0 % bila "orang
lain" diperbanyak menjadi ribuan identitas? Naskah sendiri menyatakan ekor
sebaran skor impostor belum tersampel oleh 9 identitas; uji ini mengisinya.

Ambang TIDAK dicari ulang di sini. Ambang tetap FACE_MATCH_THRESHOLD aplikasi,
dan jalur pengolahannya sama dengan ukur-far-frr.py: deteksi BlazeFace,
penyelarasan kanonik dua titik mata, 112 x 112, (x-128)/128, RGB, putusan =
median kemiripan terhadap 3 wajah terdaftar.

Tiga uji:
  A  Pemilik dari foto aplikasi (photos/, 9 identitas) melawan SELURUH wajah
     LFW sebagai impostor. Paling dekat dengan pemakaian nyata: wajah
     terdaftar adalah swafoto aplikasi, yang mencoba lolos adalah orang lain.
  B  Protokol BAB IV (leave-one-identity-out, 3 foto terdaftar, sisanya
     genuine, semua identitas lain impostor) dijalankan di dalam LFW untuk
     setiap identitas yang punya >= 4 foto.
  C  6.000 pasangan baku LFW (pairs.txt, satu foto lawan satu foto), supaya
     angkanya dapat dibandingkan dengan pustaka.
  D  (opsional, --sulit) pasangan CALFW dan CPLFW: 3.000 pasangan bukan
     pemilik yang sengaja dipilih sesama jenis kelamin dan ras - pasangan
     yang paling sulit, jadi paling dekat dengan ekor sebaran.

Kondisi foto LFW (foto berita tokoh publik) berbeda dari swafoto kamera
depan, jadi uji ini MENGUJI ambang yang sudah dipakai, bukan dasar untuk
menetapkan ambang baru.

    .venv/Scripts/python.exe uji-dataset-publik.py --lfw <folder lfw> --pairs <pairs.txt>
"""

from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image

from calibrate import Detector, Embedder, Variant, load_dataset, preprocess

# Sama dengan APP_VARIANT di ukur-far-frr.py (berkas berbentuk tanda hubung
# tidak dapat diimpor): (x-128)/128, margin 0.9, alignment kanonik, RGB.
APP_VARIANT = Variant("(x-128)/128", 0.9, True, "RGB", False)
AMBANG = 0.673
ENROLL = 3


def batas_atas_95(k: int, n: int) -> float:
    """Batas atas selang kepercayaan 95 % Clopper-Pearson untuk proporsi k/n."""
    if k >= n:
        return 1.0
    if k == 0:
        return 1 - 0.025 ** (1 / n)         # dua sisi, alpha/2 = 0,025 (sama dengan k > 0)

    def cdf(p: float) -> float:              # P(X <= k) untuk Binomial(n, p)
        return sum(math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1)
                            + i * math.log(p) + (n - i) * math.log1p(-p)) for i in range(k + 1))

    lo, hi = k / n, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if cdf(mid) > 0.025:
            lo = mid
        else:
            hi = mid
    return hi


def embed_lfw(root: Path, cache: Path, det: Detector, emb: Embedder):
    if cache.exists():
        z = np.load(cache, allow_pickle=False)
        return z["E"], list(z["orang"]), list(z["berkas"]), int(z["gagal"])
    E, orang, berkas, gagal = [], [], [], 0
    folder = sorted(p for p in root.iterdir() if p.is_dir())
    t0 = time.time()
    for i, d in enumerate(folder):
        for f in sorted(d.glob("*.jpg")):
            img = Image.open(f)
            img.load()
            g = det.detect(img, pilih="tengah")
            if g is None:
                gagal += 1
                continue
            E.append(emb.embed(preprocess(img, g, APP_VARIANT)))
            orang.append(d.name)
            berkas.append(f.name)
        if i % 500 == 0:
            print(f"  {i}/{len(folder)} identitas, {len(E)} wajah, {time.time() - t0:.0f} s", flush=True)
    E = np.stack(E).astype(np.float32)
    np.savez(cache, E=E, orang=np.array(orang), berkas=np.array(berkas), gagal=gagal)
    return E, orang, berkas, gagal


def lapor(judul, gen, imp, catatan_imp=""):
    print(f"\n{'=' * 74}\n{judul}\n{'=' * 74}")
    if gen is not None:
        fr = int((gen < AMBANG).sum())
        print(f"  genuine  : n={len(gen):>10,}  rata2 {gen.mean():.4f}  FRR {fr / len(gen):.4%} ({fr:,} ditolak)")
    fa = int((imp >= AMBANG).sum())
    print(f"  impostor : n={len(imp):>10,}  rata2 {imp.mean():.4f}  maks {imp.max():.4f}  "
          f"p99,9 {np.percentile(imp, 99.9):.4f}")
    print(f"  FAR pada {AMBANG}: {fa / len(imp):.5%}  ({fa:,} lolos)  "
          f"batas atas 95 %: {batas_atas_95(fa, len(imp)):.5%} {catatan_imp}")
    return fa


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lfw", type=Path, required=True, help="folder lfw/ berisi satu subfolder per orang")
    ap.add_argument("--pairs", type=Path, required=True, help="pairs.txt resmi LFW")
    ap.add_argument("--photos", type=Path, default=here / "photos")
    ap.add_argument("--model", type=Path, default=here.parent.parent / "assets" / "models" / "mobilefacenet.tflite")
    ap.add_argument("--detector", type=Path, default=here / "blaze_face_short_range.tflite")
    ap.add_argument("--repeat", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261103)
    ap.add_argument("--cache", type=Path, default=None)
    ap.add_argument("--pose", type=Path, default=None,
                    help="face_landmarker.task MediaPipe; bila ada, Uji D juga dilaporkan sesudah "
                         "disaring dengan gerbang pose aplikasi")
    ap.add_argument("--sulit", nargs=3, action="append", default=[],
                    metavar=("NAMA", "FOLDER_FOTO", "PAIRS"),
                    help="pasangan CALFW/CPLFW: dua baris berurutan = satu pasangan, label 0 = bukan pemilik")
    args = ap.parse_args()

    det, emb = Detector(args.detector), Embedder(args.model)
    pose_lm = None
    if args.pose:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision
        pose_lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(args.pose)),
            output_facial_transformation_matrixes=True, num_faces=1))
    cache_pose: dict[Path, tuple[float, float] | None] = {}

    def sudut(f: Path):
        """(yaw, pitch) derajat dari matriks transformasi wajah; None = tak terbaca."""
        if pose_lm is None:
            return "-"
        if f not in cache_pose:
            arr = np.asarray(Image.open(f).convert("RGB"))
            r = pose_lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=arr))
            if not r.facial_transformation_matrixes:
                cache_pose[f] = None
            else:
                R = np.array(r.facial_transformation_matrixes[0])[:3, :3]
                cache_pose[f] = (round(math.degrees(math.atan2(-R[2, 0], math.hypot(R[2, 1], R[2, 2]))), 1),
                                 round(math.degrees(math.atan2(R[2, 1], R[2, 2])), 1))
        return cache_pose[f]
    cache = args.cache or args.lfw.parent / "embedding-lfw.npz"
    print(f"Embedding LFW ({args.lfw}) ...")
    L, orang, berkas, gagal = embed_lfw(args.lfw, cache, det, emb)
    orang_arr = np.array(orang)
    n_id = len(set(orang))
    print(f"LFW: {len(L):,} wajah dari {n_id:,} identitas; {gagal} foto tanpa wajah terdeteksi dilewati")
    rng = np.random.default_rng(args.seed)

    # ------------------------------------------------------------- Uji A
    print(f"\nMemuat foto aplikasi dari {args.photos} ...")
    data = load_dataset(args.photos, det)
    pemilik = {p: np.stack([emb.embed(preprocess(i, g, APP_VARIANT)) for _, i, g in it])
               for p, it in data.items()}
    imp_a, maks_pasangan = [], {}
    for p, E in pemilik.items():
        for _ in range(args.repeat):
            daftar = E[rng.permutation(len(E))[:ENROLL]]
            s = np.median(L @ daftar.T, axis=1)
            imp_a.append(s)
            for o in set(orang_arr[s >= AMBANG - 0.1]):      # simpan calon ekor saja
                m = float(s[orang_arr == o].max())
                maks_pasangan[(p, o)] = max(maks_pasangan.get((p, o), -1), m)
    imp_a = np.concatenate(imp_a)
    lapor(f"UJI A  pemilik aplikasi (9 identitas) vs seluruh wajah LFW, {args.repeat} pengulangan",
          None, imp_a)
    pasangan_lolos = sorted(((v, k) for k, v in maks_pasangan.items() if v >= AMBANG), reverse=True)
    n_pasangan = len(pemilik) * n_id
    print(f"  dihitung per PASANGAN pemilik x identitas LFW ({n_pasangan:,} pasangan): "
          f"{len(pasangan_lolos)} pernah lolos; batas atas 95 %: "
          f"{batas_atas_95(len(pasangan_lolos), n_pasangan):.4%}")
    for v, (p, o) in pasangan_lolos[:10]:
        print(f"    {p:<10} <- {o:<28} skor {v:.4f}")
    tertinggi = sorted(((v, k) for k, v in maks_pasangan.items()), reverse=True)[:5]
    print("  lima pasangan dengan skor tertinggi:")
    for v, (p, o) in tertinggi:
        print(f"    {p:<10} <- {o:<28} skor {v:.4f}")

    # ------------------------------------------------------------- Uji B
    per_orang: dict[str, np.ndarray] = {}
    for o in sorted(set(orang)):
        idx = np.flatnonzero(orang_arr == o)
        if len(idx) >= ENROLL + 1:
            per_orang[o] = idx
    gen_b, imp_b = [], []
    for o, idx in per_orang.items():
        lain = orang_arr != o
        for _ in range(2):
            pil = rng.permutation(idx)
            daftar, uji = L[pil[:ENROLL]], L[pil[ENROLL:]]
            gen_b.append(np.median(uji @ daftar.T, axis=1))
            imp_b.append(np.median(L[lain] @ daftar.T, axis=1))
    lapor(f"UJI B  protokol BAB IV di dalam LFW: {len(per_orang)} identitas pemilik (>= 4 foto), 2 pengulangan",
          np.concatenate(gen_b), np.concatenate(imp_b))

    # ------------------------------------------------------------- Uji C
    kunci = {(o, b): i for i, (o, b) in enumerate(zip(orang, berkas))}

    def cari(o, n):
        return kunci.get((o, f"{o}_{int(n):04d}.jpg"))

    gen_c, imp_c, hilang = [], [], 0
    baris = args.pairs.read_text().split("\n")[1:]
    for b in baris:
        t = b.split()
        if len(t) == 3:
            i, j, lst = cari(t[0], t[1]), cari(t[0], t[2]), gen_c
        elif len(t) == 4:
            i, j, lst = cari(t[0], t[1]), cari(t[2], t[3]), imp_c
        else:
            continue
        if i is None or j is None:
            hilang += 1
            continue
        lst.append(float(L[i] @ L[j]))
    gen_c, imp_c = np.array(gen_c), np.array(imp_c)
    lapor(f"UJI C  6.000 pasangan baku LFW (satu foto lawan satu foto; {hilang} pasangan tanpa wajah terdeteksi)",
          gen_c, imp_c)
    benar = int((gen_c >= AMBANG).sum() + (imp_c < AMBANG).sum())
    print(f"  akurasi pada {AMBANG}: {benar / (len(gen_c) + len(imp_c)):.4%}")
    semua = np.concatenate([gen_c, imp_c])
    label = np.concatenate([np.ones(len(gen_c)), np.zeros(len(imp_c))])
    terbaik = max(((t, ((semua >= t) == label).mean()) for t in np.arange(0.2, 0.9, 0.005)), key=lambda x: x[1])
    print(f"  (pembanding pustaka) akurasi terbaik {terbaik[1]:.4%} pada ambang {terbaik[0]:.3f}")

    # ------------------------------------------------------------- Uji D
    for nama, folder, pairs in args.sulit:
        folder, baris = Path(folder), Path(pairs).read_text().split()
        isi = list(zip(baris[0::2], baris[1::2]))          # (berkas, label)
        cache_e: dict[str, np.ndarray | None] = {}

        def e(f):
            if f not in cache_e:
                img = Image.open(folder / f)
                img.load()
                g = det.detect(img, pilih="tengah")
                cache_e[f] = None if g is None else emb.embed(preprocess(img, g, APP_VARIANT))
            return cache_e[f]

        gen_d, imp_d, hilang, lolos, pose_pasangan = [], [], 0, [], []
        for (fa, la), (fb, _) in zip(isi[0::2], isi[1::2]):
            ea, eb = e(fa), e(fb)
            if ea is None or eb is None:
                hilang += 1
                continue
            sk = float(ea @ eb)
            pose_pasangan.append((la != "0", sk, fa, fb))
            if la == "0":
                imp_d.append(sk)
                if sk >= AMBANG:
                    lolos.append((sk, fa, fb))
            else:
                gen_d.append(sk)
        lapor(f"UJI D  {nama}: pasangan sulit (satu foto lawan satu foto; {hilang} pasangan tanpa wajah terdeteksi)",
              np.array(gen_d), np.array(imp_d))
        for sk, fa, fb in sorted(lolos, reverse=True):
            print(f"    lolos {sk:.4f}  {fa}  <->  {fb}  pose {sudut(folder / fa)} / {sudut(folder / fb)}")
        if pose_lm is None:
            continue
        # Aplikasi tidak pernah mencocokkan foto profil: gerbang mutu menolak
        # |yaw| > 25 dan |pitch| > 20 (utils/faceAuthNative.ts), dan foto diam
        # baru diambil sesudah wajah kembali menghadap tengah, |yaw| <= 10
        # (CENTER_DEG di hooks/useLivenessChallenge.ts). Pose diperkirakan
        # dengan FaceLandmarker MediaPipe, bukan ML Kit, jadi angkanya taksiran.
        for judul_g, batas_yaw in (("gerbang mutu |yaw|<=25, |pitch|<=20", 25), ("saat foto diambil |yaw|<=10, |pitch|<=20", 10)):
            def lulus(f):
                ps = sudut(folder / f)
                return ps is not None and abs(ps[0]) <= batas_yaw and abs(ps[1]) <= 20
            g = np.array([sk for gen, sk, fa, fb in pose_pasangan if gen and lulus(fa) and lulus(fb)])
            i = np.array([sk for gen, sk, fa, fb in pose_pasangan if not gen and lulus(fa) and lulus(fb)])
            lapor(f"UJI D  {nama} disaring pose aplikasi: {judul_g}", g, i)


if __name__ == "__main__":
    main()
