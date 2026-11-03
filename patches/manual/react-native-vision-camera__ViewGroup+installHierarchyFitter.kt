package com.mrousavy.camera.react.extensions

import android.view.View
import android.view.ViewGroup

// React does not trigger onLayout events for dynamically added views (`addView`). This fixes that.
// https://github.com/facebook/react-native/issues/17968#issuecomment-633308615
//
// PATCH: versi asli langsung memakai measuredWidth/measuredHeight saat anak
// ditambahkan. CameraX menambahkan view implementasinya (SurfaceView /
// TextureView) begitu surface request datang - dan itu bisa terjadi SEBELUM
// React Native sempat memberi ukuran pada PreviewView. Saat itu kedua nilai
// masih 0, sehingga baris layout() memaksa seluruh isi menjadi 0x0. Surface
// terlanjur dibuat berukuran nol dan preview tinggal HITAM selamanya,
// walaupun CameraX tetap melaporkan StreamState.STREAMING dan pengambilan
// foto maupun analisis frame berjalan normal.
//
// Perbaikannya dua bagian: jangan pernah memaksa layout 0x0, dan ulangi
// layout anak begitu React Native benar-benar memberi ukuran.
fun ViewGroup.installHierarchyFitter() {
  setOnHierarchyChangeListener(
    object : ViewGroup.OnHierarchyChangeListener {
      override fun onChildViewRemoved(
        parent: View?,
        child: View?,
      ) = Unit

      override fun onChildViewAdded(
        parent: View?,
        child: View?,
      ) {
        relayoutChildren()
      }
    },
  )

  addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
    val sizeChanged =
      (right - left) != (oldRight - oldLeft) || (bottom - top) != (oldBottom - oldTop)
    if (sizeChanged) {
      post { relayoutChildren() }
    }
  }
}

/** Ukur dan tata ulang isi view ini memakai ukuran nyata; tidak melakukan apa pun bila belum berukuran. */
private fun ViewGroup.relayoutChildren() {
  val w = if (measuredWidth > 0) measuredWidth else width
  val h = if (measuredHeight > 0) measuredHeight else height
  if (w <= 0 || h <= 0) return

  measure(
    View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
    View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY),
  )
  layout(0, 0, w, h)
}
