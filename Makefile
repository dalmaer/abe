.PHONY: help install init generate critique iterate run models clean

# ABE - AI Best-Effort UI Design Engine

help: ## Show this help message
	@echo "ABE - AI Best-Effort UI Design Engine"
	@echo ""
	@echo "Available commands:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm install

init: ## Initialize project with example files
	node cli/index.js init

generate: ## Generate mockups from example spec (dry-run)
	node cli/index.js generate --spec specs/parking-app.md --models image --dry-run

critique: ## Run critique example (requires generated images)
	node cli/index.js critique --help

iterate: ## Run iterate example (requires critiqued images)
	node cli/index.js iterate --help

run: ## Execute example pipeline
	node cli/index.js run --pipeline pipelines/best-effort.json --dry-run

models: ## List configured models
	node cli/index.js models

clean: ## Remove generated runs
	rm -rf runs/

# Advanced examples
example-full: ## Run full example workflow (dry-run)
	@echo "🚀 Running full example workflow..."
	node cli/index.js generate --spec specs/parking-app.md --models image --dry-run --variants 2
	@echo ""
	@echo "📋 To run the complete pipeline:"
	@echo "   make run"

google: ## Test Google Gemini image generation
	node cli/index.js generate --spec specs/parking-app.md --models google --dry-run

comparison: ## Compare all image models (dry-run)
	@echo "🔄 Comparing OpenAI DALL-E vs Google Gemini..."
	@echo ""
	@echo "OpenAI DALL-E:"
	node cli/index.js generate --spec specs/parking-app.md --models "openai:dall-e-3" --dry-run --variants 2
	@echo ""
	@echo "Google Gemini:"
	node cli/index.js generate --spec specs/parking-app.md --models google --dry-run --variants 2

dev: ## Run in development mode
	npm run dev