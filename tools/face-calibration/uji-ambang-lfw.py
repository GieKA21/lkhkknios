"""Uji A (uji-dataset-publik.py) pada beberapa ambang sekaligus.

Pertanyaan: kalau ambang aplikasi diturunkan dari 0,673, berapa wajah orang
asing (13.233 foto LFW, 5.749 identitas) yang lolos sebagai salah satu dari 9
pemilik akun? Protokol, seed, dan jumlah pengulangan sama dengan Uji A di
uji-dataset-publik.py; embedding LFW diambil dari cache yang dibuat skrip itu.

    .venv/Scripts/python.exe uji-ambang-lfw.py --cache <embedding-lfw.npz>
"""
import argparse
from pathlib import Path

import numpy as np

from calibrate import Detector, Embedder, Variant, load_dataset, preprocess

APP_VARIANT = Variant("(x-128)/128", 0.9, True, "RGB", False)


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cache", type=Path, required=True)
    ap.add_argument("--photos", type=Path, default=here / "photos")
    ap.add_argument("--repeat", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20261103)
    ap.add_argument("--ambang", type=float, nargs="+", default=[0.55, 0.60, 0.65, 0.673])
    a = ap.parse_args()

    z = np.load(a.cache, allow_pickle=False)
    L, orang = z["E"], z["orang"]
    det = Detector(here / "blaze_face_short_range.tflite")
    emb = Embedder(here.parent.parent / "assets" / "models" / "mobilefacenet.tflite")
    data = load_dataset(a.photos, det)
    pemilik = {p: np.stack([emb.embed(preprocess(i, g, APP_VARIANT)) for _, i, g in it]) for p, it in data.items()}

    rng = np.random.default_rng(a.seed)
    skor, siapa = [], []
    for p, E in pemilik.items():
        for _ in range(a.repeat):
            daftar = E[rng.permutation(len(E))[:3]]
            skor.append(np.median(L @ daftar.T, axis=1))
            siapa.append(np.full(len(L), p))
    s, pem = np.concatenate(skor), np.concatenate(siapa)
    lfw_id = np.tile(orang, len(pemilik) * a.repeat)
    n_pasangan = len(pemilik) * len(set(orang))
    print(f"{len(s):,} percobaan impostor (9 pemilik x {a.repeat} pengulangan x {len(L):,} foto LFW), "
          f"skor tertinggi {s.max():.4f}\n")
    print(f"{'ambang':>7} {'lolos':>8} {'FAR':>10} {'pasangan lolos':>16} {'pemilik terdampak':>18}")
    for t in a.ambang:
        m = s >= t
        pas = set(zip(pem[m], lfw_id[m]))
        print(f"{t:>7.3f} {int(m.sum()):>8,} {m.mean():>10.5%} {len(pas):>7,}/{n_pasangan:,} "
              f"{len(set(pem[m])):>12}/9")
    t = min(a.ambang)
    m = s >= t
    print(f"\nPasangan lolos pada {t:.3f} (pemilik <- identitas LFW, skor tertinggi):")
    best = {}
    for p, o, v in zip(pem[m], lfw_id[m], s[m]):
        best[(p, o)] = max(best.get((p, o), -1), float(v))
    for (p, o), v in sorted(best.items(), key=lambda x: -x[1])[:25]:
        print(f"  {p:<9} <- {o:<30} {v:.4f}")


if __name__ == "__main__":
    main()
