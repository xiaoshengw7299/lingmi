# Repository Guidelines

## Project Structure & Module Organization
This repository is the NestJS backend of LingMI (灵米), an AI video creation product. Application code lives in `src/`, with feature modules under `src/modules/` (for example `agent`, `atlas`, `video`, `generation`, `asset`, `prompt`, `canvas`, `short-video`, `pricing`, `billing`, `pay`, and `redis`). Shared HTTP filters, interceptors, and DTOs live in `src/common`. AI assets are kept in `ai/`: agent personas in `ai/agents/<agent>/AGENT.md` (`video-producer` and `canvas`) and skill definitions in `ai/skills/<skill-name>/SKILL.md`. Environment templates live in `env.example.txt`; the PM2 process config lives in `pm2.config.js`.

## Build, Test, and Development Commands
- Use `npm` only for dependency management and scripts in this repository. Do not use `pnpm`.
- `npm install`: install dependencies.
- `npm run start:dev`: run the NestJS server with file watching for local development.
- `npm run build`: compile TypeScript into `dist/`.
- `npm run start:prod`: run the compiled app from `dist/main`.
- `npm run lint`: run ESLint with `--fix` on `src/**/*.ts`.
- `npm run format`: format TypeScript files in `src/` with Prettier.

## Coding Style & Naming Conventions
Use TypeScript with 2-space indentation, single quotes, and trailing commas, matching `.prettierrc`. Follow NestJS naming patterns: `*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.dto.ts`, and `*.entity.ts`. Keep feature code grouped by module directory. Export shared entry points through local `index.ts` files when a module already uses that pattern. Prefer descriptive skill folder names such as `ai/skills/video-storyboard/`.

## Testing Guidelines
There is currently no `npm test` script or committed test framework in this repository. Until one is added, verify changes with `npm run lint`, `npm run build`, and focused manual API checks against `/api/agent/*`. If you add automated tests, keep them next to the feature or under a dedicated test directory and use clear names like `agent.service.spec.ts`.

## Commit & Pull Request Guidelines
Commit messages must always be written in Chinese. Keep them concise, action-oriented, and scoped to one change, for example `接入ai-sdk` and `更新配置文件`. PRs should include a brief description, impacted modules or endpoints, required environment changes, and sample requests or screenshots when behavior changes affect API responses or streamed output.

## Configuration & Security Tips
Copy `env.example.txt` to `.env` before local development and never commit secrets. Treat model keys, database credentials, and Redis settings as local configuration only. When adding new tools or skills, document required env vars and external dependencies in `README.md`.
