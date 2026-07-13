package app

import (
	"bytes"
	_ "embed"
	"image"
	_ "image/png"
)

//go:embed assets/tray_icon.png
var trayIconPNG []byte

//go:embed assets/tray_icon_windows.ico
var trayIconWindowsICO []byte

func trayIconBytes() []byte {
	return trayIconPNG
}

func trayWindowsIconBytes() []byte {
	return trayIconWindowsICO
}

func decodeTrayIcon() (image.Image, error) {
	img, _, err := image.Decode(bytes.NewReader(trayIconPNG))
	return img, err
}
