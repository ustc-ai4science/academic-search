.PHONY: test-offline test test-release

CDP_PROXY_PORT ?= 4568

test-offline:
	node --test scripts/*.test.mjs
	bash scripts/oa-pdf-download-self-test.sh

test: test-offline
	CDP_PROXY_PORT=$(CDP_PROXY_PORT) bash scripts/self-test.sh

test-release: test
	CDP_PROXY_PORT=$(CDP_PROXY_PORT) bash scripts/release-test.sh
