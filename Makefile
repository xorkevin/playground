.PHONY: all setup build dev lint format clean test devserve deploycopy

all: build

setup:
	yarn dlx @yarnpkg/sdks base

build:
	yarn run build

dev:
	yarn run build-dev

lint:
	yarn run lint

format:
	yarn run format

clean:
	yarn run clean

test:
	yarn run test

devserve:
	fsserve serve --config fsserve.json --base ./dist

deploycopy: build
	cp -r dist/* ../playground-deploy
	cp dist/index.html ../playground-deploy/404.html
