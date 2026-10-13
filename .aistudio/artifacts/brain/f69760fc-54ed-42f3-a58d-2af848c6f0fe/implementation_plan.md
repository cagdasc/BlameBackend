# BlameBackend Engineering Standards & System Architecture Documentation

A comprehensive blueprint to establish the project's developer conventions, architectural patterns, coding habits (DOs and DON'Ts), and a deep-dive multi-application tech stack breakdown.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed during Phase 1 interactive clarification:
> - **Coding Habits Scope**: Comprehensive skill covering coding habits, architecture, and DOs and DON'Ts across both Kotlin Multiplatform and TypeScript/React/Node.
> - **Tech Stack Scope**: Deep dive covering all modules, data wire protocols, and system architecture flows.
> - **Document Organization**: Dedicated `skills/` directory for the custom skill and `docs/` directory for project documentation.

---

## 1. Overview & Core Concept

### What It Delivers
This update delivers two primary deliverables tailored to the BlameBackend project:
1. **Developer Habits & Engineering Standards Skill (`skills/developer-habits/SKILL.md`)**:
   A machine-readable and human-readable skill codifying developer habits, core rules, non-destructive interception principles, privacy/redaction mandates, KMP platform separation, coroutine thread safety, and explicit DOs & DON'Ts for both Kotlin and TypeScript/Node.
2. **Deep-Dive Tech Stack & System Architecture (`docs/TECH_STACK.md`)**:
   An exhaustive technical specification analyzing all modules across the repository:
   - Kotlin Multiplatform client library (`:network-inspector`)
   - Android sample app (`:app`) & Compose Multiplatform desktop app (`:composeApp`)
   - Node.js / Express daemon with TCP socket listener & ADB bridge (`server.ts`, `adbManager.ts`)
   - React 19 / Tailwind v4 Terminal TUI Web Console (`src/`)
   - Headless Terminal CLI (`desktop-cli.ts`, `bin/blamebackend.js`)
   - Binary wire envelope protocol (`MessageType`, `WireEnvelope`, `HelloPayload`, `NetworkEventDto`)
3. **Developer Quick Reference (`docs/CODING_HABITS.md`)**:
   A companion guide in `docs/` cross-linking the skill rules with concrete code examples from the codebase.

---

## 2. Document Structure & Organization

```
/
├── skills/
│   └── developer-habits/
│       ├── SKILL.md            # Reusable AI Studio / IDE skill with coding habits, DOs & DON'Ts
│       └── references/
│           ├── kotlin-kmp.md   # Detailed KMP, OkHttp, Ktor & coroutines patterns
│           └── web-node.md     # Node TCP, Express SSE, React 19 TUI patterns
├── docs/
│   ├── TECH_STACK.md           # Deep dive into modules, architectures, wire protocols
│   └── CODING_HABITS.md        # Companion reference for quick review & pull request checks
└── README.md                   # Updated with reference to docs/
```

---

## 3. Core Content Specifications

### Deliverable A: Developer Habits Skill (`skills/developer-habits/SKILL.md`)
- **Metadata Frontmatter**: Standard YAML skill definition (`name: "developer-habits"`, clear description).
- **Golden Principle**: Zero-Semantics Alteration (network inspection must NEVER modify original payload, status, headers, or exception flow).
- **Core Kotlin Multiplatform Habits**:
  - Non-destructive stream tapping (`peekBody` for OkHttp, double-receive / saved state for Ktor).
  - Explicit error propagation: Always catch, dispatch to event bus, and re-throw (never swallow exceptions).
  - Defensive Redaction: Mandatory lowercase matching and token scrubbing for sensitive credentials.
  - Multiplatform target isolation: Keep business logic, event formatting, and redaction in `commonMain`; isolate OS specifics in `androidMain`, `jvmMain`, `nativeMain`.
  - Fail-soft transport: If TCP daemon is down, socket errors must fail silently without lagging or crashing host apps.
- **Core TypeScript, Node & React Habits**:
  - Dual Mode Architecture: Server runs both Web TUI and headless CLI with shared wire decoders.
  - Reactive stream over SSE: Single source of truth for events, avoiding double serialization.
  - Terminal-first UI ergonomics: Monospace styling, dark high-contrast themes, vim-inspired keybindings (`j`/`k`, `/`, `Tab`, `c`).
  - Separation of concerns: Keep ADB process manipulation encapsulated in dedicated manager classes.
- **DOs and DON'Ts Matrix**: Direct, actionable table comparing good code patterns vs bad code anti-patterns.

### Deliverable B: Tech Stack Deep Dive (`docs/TECH_STACK.md`)
- **System Architecture Diagram**: End-to-end ASCII diagram illustrating packet flow from Mobile App -> Socket Wire -> Node Daemon / ADB Forwarder -> Web TUI & CLI.
- **Per-Application Breakdown**:
  - **Module 1: Kotlin Multiplatform Library (`:network-inspector`)**
    - Targets, Gradle build configuration, versions (`kotlinx-coroutines`, `kotlinx-serialization`, `okhttp`, `ktor`).
    - Internal architecture: `InspectorEventBus`, `InspectorClient`, `NetworkEventCapture`, `PayloadUtils`.
  - **Module 2: Client Sample Apps (`:app` and `:composeApp`)**
    - Android Jetpack / Material 3 setup and Compose Multiplatform desktop runner.
  - **Module 3: Node.js Backend & ADB Manager (`server.ts`, `adbManager.ts`)**
    - Raw TCP listener (port 10245), Express REST endpoints, Server-Sent Events (SSE).
    - Child process execution of ADB (`adb devices -l`, `adb forward tcp:... tcp:...`).
  - **Module 4: React 19 Frontend Web Console (`src/`)**
    - React 19, Tailwind CSS v4, Motion, Lucide icons, Vite.
    - Custom filter parser, hex viewer, mock simulator, custom request dispatcher.
  - **Module 5: Headless Terminal CLI (`desktop-cli.ts`)**
    - Direct TCP connection to daemon or device, real-time ANSI terminal logging.
- **Wire Protocol Specification**:
  - JSON envelope schema, message types (`HELLO`, `NETWORK_EVENT`, `PING`, `PONG`, `GOODBYE`).
  - Payload handling, size bounds (64KB limits), truncation flags, and binary hex previews.

---

## 4. Technical Architecture & Component Flow

```
┌─────────────────────────────────────────────────────────────┐
│                 Target Applications                         │
│  Android App (:app)     Desktop App (:composeApp)   iOS/JVM │
│  ┌───────────────────┐  ┌─────────────────────────┐         │
│  │ OkHttpInterceptor │  │   KtorInspectorPlugin   │         │
│  └─────────┬─────────┘  └────────────┬────────────┘         │
│            └──────────────┬──────────┘                      │
│            ┌──────────────▼───────────────────────┐         │
│            │ :network-inspector (KMP commonMain) │         │
│            │  - Redaction & Payload Peeking       │         │
│            │  - InspectorClient (TCP 10245)       │         │
│            └──────────────┬───────────────────────┘         │
└───────────────────────────┼─────────────────────────────────┘
                            │ Raw TCP (WireEnvelope JSON)
                            │ [USB / Wi-Fi via ADB port forward]
┌───────────────────────────▼─────────────────────────────────┐
│              BlameBackend Host Daemon / CLI                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Node.js net.Server (127.0.0.1:10245)                  │  │
│  │ ADB Bridge Manager (executes adb forward tcp:10245)   │  │
│  └───────────────┬───────────────────────────┬───────────┘  │
│                  │ SSE Broadcast             │ ANSI Stream  │
│                  ▼                           ▼              │
│       ┌──────────────────────┐    ┌─────────────────────┐   │
│       │ React 19 Web Console │    │ Headless Shell CLI  │   │
│       │ (Vite / Tailwind v4) │    │ (desktop-cli.ts)    │   │
│       └──────────────────────┘    └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Verification Strategy

1. **Markdown & Syntax Validation**: Ensure all markdown files and code snippets parse cleanly with zero linting issues.
2. **Skill Verification**: Confirm that `skills/developer-habits/SKILL.md` conforms to skill frontmatter standards.
3. **Build Check**: Run `compile_applet` to ensure no workspace builds or scripts were disturbed.
