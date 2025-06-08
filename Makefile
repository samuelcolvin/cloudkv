.DEFAULT_GOAL := all
sources = pytest_pretty

.PHONY: .uv
.uv: ## Check that uv is installed
	@uv --version || echo 'Please install uv: https://docs.astral.sh/uv/getting-started/installation/'

.PHONY: .pre-commit
.pre-commit: ## Check that pre-commit is installed
	@pre-commit -V || echo 'Please install pre-commit: https://pre-commit.com/'

.PHONY: install
install: .uv .pre-commit ## Install the package, dependencies, and pre-commit for local development
	uv sync --frozen
	pre-commit install --install-hooks

.PHONY: format-py
format-py: ## Format Python code
	uv run ruff format
	uv run ruff check --fix --fix-only

.PHONY: format-ts
format-ts: ## Format TS and JS code
		cd cf-worker && npm run format

.PHONY: format
format: format-py format-ts ## Format all code

.PHONY: lint-py
lint-py: ## Lint Python code
	uv run ruff format --check
	uv run ruff check

.PHONY: lint-ts
lint-ts: ## Lint TS and JS code
	cd cf-worker && npm run lint

.PHONY: lint
lint: lint-py lint-ts ## Lint all code

.PHONY: typecheck-py
typecheck-py: ## Typecheck the code
	@# PYRIGHT_PYTHON_IGNORE_WARNINGS avoids the overhead of making a request to github on every invocation
	PYRIGHT_PYTHON_IGNORE_WARNINGS=1 uv run pyright

.PHONY: typecheck-ts
typecheck-ts: ## Typecheck TS and JS code
	cd cf-worker && npm run typecheck

.PHONY: typecheck
typecheck: typecheck-py typecheck-ts ## Typecheck all code

.PHONY: test-py
test-py: ## Run Python tests
	uv run coverage run -m pytest
	uv run coverage report --fail-under=100

.PHONY: testcov
testcov: test-py ## Run python tests and generate a coverage report
	@echo "building coverage html"
	@uv run coverage html

.PHONY: test-ts
test-ts: ## Run TS and JS tests
	cd cf-worker && CI=1 npm run test

.PHONY: test
test: test-py test-ts ## Run all tests

.PHONY: test-all-python
test-all-python: ## Run tests on Python 3.9 to 3.13
	UV_PROJECT_ENVIRONMENT=.venv39 uv run --python 3.9 coverage run -p -m pytest
	UV_PROJECT_ENVIRONMENT=.venv310 uv run --python 3.10 coverage run -p -m pytest
	UV_PROJECT_ENVIRONMENT=.venv311 uv run --python 3.11 coverage run -p -m pytest
	UV_PROJECT_ENVIRONMENT=.venv312 uv run --python 3.12 coverage run -p -m pytest
	UV_PROJECT_ENVIRONMENT=.venv313 uv run --python 3.13 coverage run -p -m pytest
	@uv run coverage combine
	@uv run coverage report

.PHONY: all
all: format typecheck test ## run format, typecheck and test

.PHONY: help
help: ## Show this help (usage: make help)
	@echo "Usage: make [recipe]"
	@echo "Recipes:"
	@awk '/^[a-zA-Z0-9_-]+:.*?##/ { \
		helpMessage = match($$0, /## (.*)/); \
		if (helpMessage) { \
			recipe = $$1; \
			sub(/:/, "", recipe); \
			printf "  \033[36m%-20s\033[0m %s\n", recipe, substr($$0, RSTART + 3, RLENGTH); \
		} \
	}' $(MAKEFILE_LIST)
