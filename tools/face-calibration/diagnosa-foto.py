"""Cari foto pencilan: foto yang skornya rendah terhadap foto lain dari ORANG YANG SAMA.

Dipakai untuk menjelaskan dari mana FRR berasal - kegagalan sistem, atau
segelintir foto yang deteksi/alignment-nya meleset.
"""
from pathlib import Path
import numpy as np
from calibrate import Detector, Embedder, Variant, load_dataset, preprocess

APP_VARIANT = Variant("(x-128)/128", 0.9, True, "RGB", False)
here = Path(__file__).resolve().parent

data = load_dataset(here / "photos", Detector(here / "blaze_face_short_range.tflite"))
embedder = Embedder(here.parent.parent / "assets" / "models" / "mobilefacenet.tflite")

names: dict[str, list[str]] = {}
embeds: dict[str, np.ndarray] = {}
for person, items in data.items():
    names[person] = [n for n, _, _ in items]
    embeds[person] = np.stack([embedder.embed(preprocess(img, geom, APP_VARIANT)) for _, img, geom in items])

print("\n" + "=" * 78)
print("SKOR TIAP FOTO TERHADAP SAUDARA SE-IDENTITAS (median)")
print("=" * 78)
print(f"{'identitas':<12} {'berkas':<34} {'median':>8} {'min':>8}  catatan")
for person, E in sorted(embeds.items()):
    S = E @ E.T
    np.fill_diagonal(S, np.nan)
    for k, fname in enumerate(names[person]):
        row = S[k][~np.isnan(S[k])]
        med, lo = float(np.median(row)), float(row.min())
        note = ""
        if med < 0.45:
            note = "<-- PENCILAN BERAT (deteksi/alignment kemungkinan meleset)"
        elif med < 0.60:
            note = "<-- lemah"
        print(f"{person:<12} {fname[:34]:<34} {med:>8.4f} {lo:>8.4f}  {note}")
