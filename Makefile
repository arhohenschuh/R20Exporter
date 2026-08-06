all: test build

build: 
	rm -f *~ */*~ */*/*~
	web-ext build --ignore-files package.json package-lock.json "tests/**" "tools/**" "docs/**" "node_modules/**"

test:
	node --test "tests/**/*.test.js"

.PHONY: all build test
