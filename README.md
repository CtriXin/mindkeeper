# Auto-Skills Project Documentation

A comprehensive automation and deployment toolkit for domain configuration management and CI/CD processes.

## Project Structure

```
auto-skills/
├── bin/                    # Executable scripts accessible via PATH
│   ├── deploy             # Main deployment script (SCMP integration)
│   ├── push               # Git push helper with notifications
│   ├── lookup             # Domain/service lookup utility
│   ├── claude-provider    # Claude Code provider script
│   └── figmamcp           # Figma integration script
├── scmp-deploy/           # SCMP (Service Control Management Platform) tools
│   ├── README.md          # Deployment tool documentation
│   └── scripts/
│       ├── scmp_cli.py    # Standalone SCMP CLI
│       └── scmp_api.py    # HTTP API wrapper
├── domain-tool-core/      # Central domain configuration engine
│   ├── index.js           # Main domain tool engine
│   ├── install.js         # Installation script for anchor system
│   ├── MAINTENANCE.md     # Maintenance manual
│   └── package.json       # Dependencies and package info
├── backup/                # Backup configurations and skills
└── .skills/              # Skill configurations
```

## Core Components

### 1. Domain Tool Core (`domain-tool-core/`)

The central engine for domain configuration management that generates JSON configurations from Excel spreadsheets.

**Key Features:**
- Excel parsing and configuration generation
- Ads mapping system with placeholder syntax
- Dynamic ad slot resolution
- Configuration template support

**Important Files:**
- `index.js`: Main engine implementation
- `install.js`: Sets up global anchor for cross-project access
- `MAINTENANCE.md`: Complete maintenance and upgrade guide

**Configuration Syntax (v2.7.0+):**
```javascript
adsMapping: {
  adsense: {
    'home_1': '${home_1}',     // New placeholder syntax
    'list_top': '${list_1}'    // Left: output key, Right: Excel column
  },
  adx: {
    'list_top': '${list_1}',
    'categories[0]': '${list_2}', // Array element support
    'categories[1]': '${list_3}'
  }
}
```

### 2. SCMP Deploy Tools (`scmp-deploy/`)

Standalone command-line interface for deploying services through SCMP without opening a browser UI.

**Features:**
- Authentication token management
- Service discovery and pipeline selection
- Parameter inference from current deployments
- Automated deployment workflows

**Commands:**
- `login`: Authenticate and save token
- `service`: Search for services
- `pipelines`: List pipelines for a service
- `current`: Get current pipeline run parameters
- `run`: Trigger pipeline run
- `deploy`: One-shot deployment (recommended)

**Usage:**
```bash
# Login (first time setup)
python3 scmp-deploy/scripts/scmp_cli.py login --share-id "<share_id>" --prompt-password

# Deploy service (interactive mode)
deploy my-service-name

# Or direct CLI usage
python3 scmp-deploy/scripts/scmp_cli.py deploy my-service-name --env prod
```

### 3. Global Scripts (`bin/`)

#### `deploy` Script
The primary deployment command that wraps `scmp_cli.py`. Can infer service names from the current git repository.

**Features:**
- Automatic service name detection from `.deploy-service` or `.deploy-name`
- Interactive deployment with intelligent defaults
- Daily token refresh

#### `push` Script
Enhanced git push workflow with notifications and version bumping.

**Features:**
- Automatic version incrementation for branch names
- Commit message prompting
- Optional Feishu notifications
- Pre/post hook support
- Automatic `.deploy-service` file creation

**Usage:**
```bash
# Standard push with commit message
push -m "feat: add new functionality"

# Push without notifications
push -m "fix: resolve issue" --no-notify

# Interactive push
push  # Prompts for commit message
```

#### `lookup` Script
Domain and service lookup utility for identifying associated services.

## Setup Instructions

### Prerequisites
- Node.js >= 14.0.0
- Python 3.x
- Git

### Initial Setup

1. **Add bin directory to PATH:**
```bash
echo 'export PATH="/Users/xin/auto-skills/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

2. **Setup domain-tool-core anchor (if moving/renaming directory):**
```bash
cd /path/to/auto-skills/domain-tool-core
node install.js
```

3. **SCMP Deployment Setup:**
```bash
# Set your share ID
export SCMP_SHARE_ID='<your-share-id>'

# Login to SCMP (token stored securely)
python3 scmp-deploy/scripts/scmp_cli.py login --prompt-password
```

4. **Configure Feishu notifications (optional):**
```bash
export FEISHU_WEBHOOK='<your-feishu-webhook-url>'
export PUSH_NOTIFY=1  # Enable auto-notifications
```

## Key Workflows

### 1. Service Deployment Workflow
1. Navigate to your service repository
2. Make your changes
3. Use `push -m "commit message"` to commit and push with version bumping
4. Use `deploy` (infers service name) or `deploy service-name` to deploy

### 2. Domain Configuration Workflow
1. Prepare Excel spreadsheet with domain configurations
2. Generate configuration using domain-tool-core
3. Review `suggested-config.js` for correct mapping syntax
4. Deploy updated configurations

### 3. Development Best Practices
- Use meaningful commit messages with conventional prefixes (feat:, fix:, chore:, etc.)
- Always review `suggested-config.js` when updating domain configurations
- Maintain consistent branch naming with version numbers (e.g., `feature-1.2.3`)
- Configure appropriate notification settings for team awareness

## Security Notes

- Tokens are stored locally with 0600 permissions
- Passwords are never stored in plain text
- Use `--plain-password` flag carefully as it echoes passwords to terminal
- Regular token refresh mechanism prevents stale authentication

## Troubleshooting

- If domain-tool-core path breaks after directory movement, run `node install.js` from the core directory
- For deployment authentication issues, run the login command again
- Check `.deploy-service` file exists in repositories for proper deployment integration
- Review `scmp-deploy/README.md` for detailed troubleshooting of deployment issues

For more detailed information on specific components, see the individual README files in each directory.