all: test build

build:
	node tools/build.js

test:
	node --test "tests/**/*.test.js"

.PHONY: all build test
