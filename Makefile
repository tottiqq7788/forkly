.PHONY: dev web build test e2e package-macos package-windows fetch-git clean preview-api preview-web verify-oauth

VERSION ?= $(shell cat VERSION 2>/dev/null || echo 0.1.0)
ARCH ?= arm64
APP_NAME = Forkly
BUNDLE_ID = app.forkly.desktop

# Optional GitHub OAuth (see .env.example). Loaded from .env.local when present.
-include .env.local
FORKLY_GITHUB_CLIENT_ID ?=
FORKLY_GITHUB_CLIENT_SECRET ?=
GITHUB_LDFLAGS = -X github.com/forkly-app/forkly/internal/github.ClientID=$(FORKLY_GITHUB_CLIENT_ID) -X github.com/forkly-app/forkly/internal/github.ClientSecret=$(FORKLY_GITHUB_CLIENT_SECRET)

# Vite UI only (needs preview-api in another terminal for real data)
preview-web:
	cd web && npm install && npm run dev -- --host 127.0.0.1

# Local API for Vite proxy (no menu bar; fixed :8787 + dev-login)
preview-api:
	FORKLY_DEV=1 go run -ldflags "$(GITHUB_LDFLAGS)" ./cmd/forkly

dev: web
	@echo "Build web done. Run: go run ./cmd/forkly"

web:
	cd web && npm install && npm run build

build: web
	CGO_ENABLED=1 go build -ldflags "-X github.com/forkly-app/forkly/internal/app.Version=$(VERSION) $(GITHUB_LDFLAGS)" -o bin/forkly ./cmd/forkly
	CGO_ENABLED=1 go build -o bin/forkly-askpass ./cmd/forkly-askpass
	CGO_ENABLED=0 go build -ldflags "-X github.com/forkly-app/forkly/internal/cli.Version=$(VERSION)" -o bin/forklyctl ./cmd/forklyctl

test:
	go test ./...

verify-oauth: build
	bash scripts/verify-oauth-build.sh

e2e: build
	node web/e2e/smoke.mjs
	node web/e2e/editor-smoke.mjs

fetch-git:
	bash scripts/fetch-git-runtime.sh $(ARCH)

package-macos: web fetch-git
	bash packaging/macos/build.sh $(VERSION) $(ARCH)

package-windows:
	powershell -ExecutionPolicy Bypass -File packaging/windows/build.ps1 -Version $(VERSION) -Arch x64

clean:
	rm -rf bin dist web/node_modules
	rm -rf internal/webui/dist/assets
	printf '%s\n' '<!DOCTYPE html><html><body>build web</body></html>' > internal/webui/dist/index.html
