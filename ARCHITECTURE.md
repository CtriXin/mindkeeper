# Project Architecture Documentation

This document provides a comprehensive overview of the Auto-Skills project architecture, detailing the relationships between components and how they work together.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Auto-Skills Project                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │   bin/ Scripts  │────│     Global Operations      │   │
│  │                 │    │                              │   │
│  │ • deploy        │    │ • PATH integration         │   │
│  │ • push          │    │ • Cross-component workflow │   │
│  │ • lookup        │    │ • Notification system      │   │
│  │ • etc.          │    │                              │   │
│  └─────────────────┘    └──────────────────────────────┘   │
│              │                                             │
│              ▼                                             │
│  ┌─────────────────────────────────────────────────────────┤
│  │                  Core Components                       │
├─ │ ┌─────────────────┐    ┌──────────────────────────────┐ │
│  │ │Domain Tool Core │    │     SCMP Deploy Tools      │ │
│  │ │                 │    │                              │ │
│  │ │ • Excel parsing │────│ • Authentication           │ │
│  │ │ • Config gen.   │    │ • Service discovery        │ │
│  │ │ • Ad mapping    │    │ • Deployment automation    │ │
│  │ │ • Templates     │    │ • CI/CD integration        │ │
│  │ └─────────────────┘    └──────────────────────────────┘ │
│  │                                                         │
│  └─────────────────────────────────────────────────────────┘
│                              │                             │
│                              ▼                             │
│  ┌─────────────────────────────────────────────────────────┤
│  │               Infrastructure Layer                     │
├─ │ ┌─────────────────┐    ┌──────────────────────────────┐ │
│  │ │  Backup/Skills  │    │        Utilities           │ │
│  │ │                 │    │                              │ │
│  │ │ • Config backup │    │ • Knowledge wiki           │ │
│  │ │ • Skills system │    │ • Development tools        │ │
│  │ │ • Templates     │    │ • Helper scripts           │ │
│  │ └─────────────────┘    └──────────────────────────────┘ │
│  │                                                         │
│  └─────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

## Component Relationships

### 1. Domain Tool Core ←→ SCMP Deploy Tools

The Domain Tool Core and SCMP Deploy Tools work closely together:

- **Domain Tool Core** generates configuration files that may be deployed using SCMP
- **SCMP Deploy Tools** consume the configuration artifacts produced by Domain Tool Core
- Both use the global anchor system for coordination
- Share common workflow patterns (configuration → validation → deployment)

### 2. bin/ Scripts ←→ All Components

The global scripts provide unified access to all components:

- **deploy** integrates with SCMP Deploy Tools and respects Domain Tool Core outputs
- **push** coordinates git operations across all components
- **lookup** provides unified search across all domain configurations

### 3. Backup/Skills ←→ Core Components

Provides safety and extensibility layers:

- **Backup** preserves configuration states from Domain Tool Core
- **Skills** extend functionality of all core components
- **Templates** provide reusable patterns across the system

## Data Flow

### Configuration Generation Workflow

```
Excel Spreadsheet → Domain Tool Core → JSON Config → SCMP Deploy → Live Service
     │                   │                  │              │            │
     │                   │                  │              │            │
     └───────────────────┤                  │              │            │
                         │                  │              │            │
                         └──────────────────┤              │            │
                                            │              │            │
                                            └──────────────┤            │
                                                           │            │
                                                           └────────────┘
```

### Deployment Workflow

```
Git Repo → push Script → Version Bump → Commit → Push → deploy Script → SCMP → Live Service
    │          │            │            │        │         │            │
    │          │            │            │        │         │            │
    └──────────┼────────────┼────────────┼────────┼─────────┼────────────┘
               │            │            │        │         │
               └────────────┼────────────┼────────┼─────────┘
                            │            │        │
                            └────────────┼────────┘
                                         │
                                         └─────────┘
```

## Architecture Principles

### 1. Decentralized Access

- Components can operate independently
- Global anchor system enables coordination without tight coupling
- Scripts provide unified interfaces to decentralized functionality

### 2. Security First

- Credentials never stored in plain text
- Tokens managed with proper permissions
- Secure authentication flows
- Minimal data exposure

### 3. Convention Over Configuration

- Standard file names (`.deploy-service`, etc.)
- Consistent directory structures
- Predictable behavior based on conventions
- Intelligent defaults based on context

### 4. Extensibility

- Hook system for custom behaviors
- Template system for flexible configurations
- Skills system for extended functionality
- Modular architecture enables additions

## Technical Patterns

### Global Anchor Pattern

```
Component A → Reads ~/.domain-tool-core-anchor → Resolves Core Path → Uses Core Functionality
Component B → Reads ~/.domain-tool-core-anchor → Resolves Core Path → Uses Core Functionality
```

This allows moving the core directory without breaking dependent components.

### Convention-Based Configuration

Components use file system conventions to determine behavior:
- `.deploy-service` in git repo → determines deployment target
- Excel column names → map to configuration keys
- Branch names → influence version strategies

### Progressive Enhancement

Scripts enhance basic functionality:
- Basic git push → enhanced with versioning, notifications, hooks
- Basic SCMP access → enhanced with authentication, parameter inference
- Basic lookups → enhanced with domain intelligence

## Integration Points

### Git Integration
- Branch detection and versioning
- Repository-specific configurations
- Push automation and notifications

### External Services
- SCMP for deployment orchestration
- Feishu for team notifications
- Excel for configuration data

### Local Environment
- PATH integration for global access
- Token file management
- Local anchor system

## Scaling Considerations

### Horizontal Scaling
- Independent component execution
- Parallel operation possible
- Distributed anchor system

### Vertical Scaling
- Large Excel files handled efficiently
- Multiple simultaneous deployments possible
- Concurrent git operations supported

### Maintenance Scaling
- Clear separation of concerns
- Independent upgrade paths
- Isolated failure domains

## Security Architecture

### Authentication Layer
- Token-based with refresh mechanisms
- Environment-driven configuration
- Secure storage with restricted permissions

### Data Protection
- No plaintext passwords
- Encrypted communication
- Secure credential handling

### Access Control
- Principle of least privilege
- Component-level isolation
- Environment-based configuration

## Operational Patterns

### Configuration Management
- Excel-to-JSON transformation
- Version-controlled configurations
- Backup and recovery procedures

### Deployment Automation
- Continuous integration-ready
- Automated parameter inference
- Intelligent rollback capabilities

### Monitoring and Observability
- Structured logging
- Notification systems
- Status tracking and reporting

This architecture enables rapid development and deployment while maintaining security, scalability, and maintainability.