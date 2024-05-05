.PHONY: all setup build dev lint format clean cleandist test devserve deploycopy

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

cleandist:
	if [ -d ./dist ]; then rm -r ./dist; fi

test:
	yarn run test

devserve:
	fsserve serve --config fsserve.json --base ./dist

deploycopy: cleandist build
	if [ -d ../playground-deploy -a -d ../playground-deploy/static ]; then rm -r ../playground-deploy/static; fi
	cp -r dist/* ../playground-deploy
	cp dist/index.html ../playground-deploy/404.html
