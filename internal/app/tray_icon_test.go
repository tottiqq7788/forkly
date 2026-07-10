package app

import (
	"image"
	"testing"
)

func TestTrayIconEmbedded(t *testing.T) {
	if len(trayIconPNG) == 0 {
		t.Fatal("tray icon embed is empty")
	}
	img, err := decodeTrayIcon()
	if err != nil {
		t.Fatalf("decode tray icon: %v", err)
	}
	b := img.Bounds()
	if b.Dx() < 16 || b.Dy() < 16 {
		t.Fatalf("tray icon too small: %dx%d", b.Dx(), b.Dy())
	}
	if b.Dx() != b.Dy() {
		t.Fatalf("tray icon should be square, got %dx%d", b.Dx(), b.Dy())
	}
	// Ensure at least some opaque pixels exist (not blank).
	opaque := 0
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			_, _, _, a := img.At(x, y).RGBA()
			if a > 0 {
				opaque++
			}
		}
	}
	if opaque == 0 {
		t.Fatal("tray icon has no visible pixels")
	}
	_ = image.Image(img)
}
