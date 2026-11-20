.DEFAULT_GOAL := help
.PHONY: help deps build dev test test-obsidian lint lint-fix check install

# 原样导出路径，避免将空格或特殊字符插入 shell 命令。
export CODE_TAB_VAULT := $(value vault)

help:
	@node scripts/install.mjs --help

deps:
	npm ci

build:
	npm run build

dev:
	npm run dev

test:
	npm test

test-obsidian:
	npm run test:obsidian

lint:
	npm run lint

lint-fix:
	npm run lint:fix

check:
	npm test
	npm run build
	npm run lint

install:
	node scripts/install.mjs
