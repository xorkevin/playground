.PHONY: all setup buildlib build dev lint format clean cleandist devserve deploycopy

all: build

setup:
	yarn dlx @yarnpkg/sdks base

buildlib:
	mkdir -p ./bin
	GOOS=wasip1 GOARCH=wasm go build -trimpath -ldflags "-w -s" -o ./bin/jsonnet.wasm ./pkg/engine/jsonnet
	wasm-opt -Os --enable-bulk-memory -o ./bin/jsonnet.engine.wasm ./bin/jsonnet.wasm

build: buildlib
	yarn run build

dev: buildlib
	yarn run build-dev

lint:
	yarn run lint

format:
	yarn run format

clean:
	if [ -d ./bin ]; then rm -r ./bin; fi
	yarn run clean

cleandist:
	if [ -d ./dist ]; then rm -r ./dist; fi

devserve:
	fsserve serve --config fsserve.json --base ./dist

deploycopy: cleandist build
	if [ -d ../playground-deploy -a -d ../playground-deploy/static ]; then rm -r ../playground-deploy/static; fi
	cp -r dist/* ../playground-deploy
	cp dist/index.html ../playground-deploy/404.html
