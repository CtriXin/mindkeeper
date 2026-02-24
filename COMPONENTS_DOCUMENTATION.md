# Auto-Skills Project Documentation

## Overview
The Auto-Skills project is a comprehensive automation and deployment toolkit that includes domain configuration tools and SCMP (Service Control Management Platform) deployment utilities.

## Main Components

### 1. Domain Tool Core
Located at `/Users/xin/auto-skills/domain-tool-core/`
- Converts Excel spreadsheets into domain configuration JSON
- Implements the "Mother Core" engine for centralized configuration management
- Uses a global anchor system for cross-project access
- Generates ads mapping configurations

### 2. SCMP Deployment Tools
Located at `/Users/xin/auto-skills/scmp-deploy/`
- Provides CLI tools for deploying services through SCMP
- Offers authentication management with secure token handling
- Automates service discovery and pipeline triggering
- Ensures secure credential handling

### 3. Global Bin Scripts
Located at `/Users/xin/auto-skills/bin/`
- Provides globally accessible command-line utilities
- Integrates all project components into unified workflow
- Includes enhanced git operations with notifications

## Bin Scripts Documentation

### deploy
Wrapper script for the SCMP CLI tool to deploy services.

**Purpose:**
- Provides an easy way to deploy services through SCMP
- Automatically infers service names from the current git repository
- Handles authentication and token management

**Parameters:**
- No parameters: Will try to infer service name from `.deploy-service` or `.deploy-name` files in the current git repository, otherwise prompts for service name
- `<service-name>`: Specifies the service to deploy
- Additional flags passed through to the underlying SCMP CLI (e.g., `--env`, `--branch`, `--version`)

**Usage Examples:**
```bash
# Interactive deployment
deploy

# Deploy specific service
deploy my-service-name

# Deploy with specific parameters
deploy my-service --env prod --branch main --version 1.2.3
```

**How it works:**
1. Checks for service name in `.deploy-service` or `.deploy-name` files if in a git repository
2. Falls back to prompting for service name if none found
3. Calls the underlying Python script with the appropriate arguments
4. Handles daily token refresh if needed

### push
Enhanced git push workflow with version bumping and notification capabilities.

**Purpose:**
- Improves the git push workflow with version management
- Supports pre/post push hooks for custom actions
- Provides optional notifications via Feishu
- Automatically manages repository-specific configuration

**Parameters:**
- `-m "commit message"` or `--message`: Provide commit message directly
- `--no-notify`: Disable notifications
- `-h` or `--help`: Show usage information

**Environment Variables:**
- `FEISHU_WEBHOOK`: Webhook URL for notifications
- `PUSH_NOTIFY`: If set to 1, auto-send notifications without prompting
- `PUSH_LOCAL_HOOK`: Path to local pre-push hook script
- `PUSH_POST_HOOK`: Path to post-push hook script
- `PUSH_SKIP_BUMP`: If set to 1, skip version bumping prompts

**Usage Examples:**
```bash
# Interactive push with commit message prompt
push

# Push with commit message
push -m "feat: add new functionality"

# Push without notifications
push -m "fix: resolve issue" --no-notify
```

**How it works:**
1. Identifies current git repository
2. Prompts for and sets up deployment name if needed
3. Performs version incrementation on branch names (e.g., feature-1.0.0 → feature-1.0.1)
4. Executes pre-hooks if defined
5. Adds all changes, commits, and pushes
6. Sends optional notifications
7. Executes post-hooks if defined

### lookup
Service/domain lookup utility.

**Purpose:**
- Provides quick access to service and domain information
- Wraps the service lookup Python script
- Can run from any location

**Parameters:**
- Accepts any arguments and passes them to the underlying Python script

**Usage Examples:**
```bash
# Lookup service information
lookup service-name

# Search for domain information
lookup domain-keyword
```

**How it works:**
1. Simply calls the Python service lookup script with provided arguments
2. Displays search results for services/domains

### figmamcp
Figma integration script for SCMP.

**Purpose:**
- Integrates Figma design assets with SCMP
- Manages design-to-development workflows

### claude-provider
Claude Code provider script.

**Purpose:**
- Integrates Claude Code with the project's tools
- Provides project context to Claude for enhanced development workflows

## SCMP CLI Commands Documentation

The underlying `scmp_cli.py` script supports several subcommands:

### login
Authenticate with SCMP and save token.

**Usage:**
```bash
python3 scmp_cli.py login --share-id "<share_id>" --prompt-password
```

**Parameters:**
- `--share-id`: SCMP share ID (or use SCMP_SHARE_ID environment variable)
- `--password`: SCMP password (or use SCMP_PASSWORD environment variable)
- `--plain-password`: Prompt password with echo (plaintext)
- `--prompt-password`: Force password prompt (overrides --password/SCMP_PASSWORD)
- `--no-save`: Don't save token file

### service
Search for services in SCMP.

**Usage:**
```bash
python3 scmp_cli.py service <keyword>
```

**Parameters:**
- `<keyword>`: Service name or search term

### pipelines
List pipelines for a service.

**Usage:**
```bash
python3 scmp_cli.py pipelines <service> [options]
```

**Parameters:**
- `<service>`: Service name
- `--group`: CI group (default: FE)
- `--project`: CI project (default: fe)
- `--pipeline-name`: Filter by pipeline name
- `--limit`: Limit results (default: 12)

### current
Get current pipeline run and infer parameters.

**Usage:**
```bash
python3 scmp_cli.py current <service> <pipeline>
```

**Parameters:**
- `<service>`: Service name
- `<pipeline>`: Pipeline name
- `--group`: CI group (default: FE)
- `--project`: CI project (default: fe)

### run
Trigger pipeline run with a payload.

**Usage:**
```bash
python3 scmp_cli.py run <service> <pipeline> [options]
```

**Parameters:**
- `<service>`: Service name
- `<pipeline>`: Pipeline name
- `--group`: CI group (default: FE)
- `--project`: CI project (default: fe)
- `--payload`: JSON string payload
- `--payload-file`: JSON file payload
- `--print-payload`: Print resolved run URL + payload before posting

### deploy
Complete deployment workflow: service → pipelines → current → run.

**Usage:**
```bash
python3 scmp_cli.py deploy <service> [options]
```

**Parameters:**
- `<service>`: Service name
- `--group`: CI group (default: FE)
- `--project`: CI project (default: fe)
- `--env`: Environment (test/prod)
- `--branch`: Branch name
- `--tag`: Tag
- `--version`: Version
- `--path`: Path
- `--interactive`/`--no-interactive`: Toggle interactive mode (default: true)
- `--share-id`: SCMP share ID
- `--plain-password`: Use plain password during login
- `--daily-login`/`--no-daily-login`: Toggle daily login requirement
- `--print-payload`: Print payload before posting
- `--deploy`: Set DEPLOY parameter (true/false)

## Security Considerations

### Authentication and Tokens
- Passwords are never stored in plain text
- Authentication tokens are stored with 0600 permissions (read/write for owner only)
- Daily token refresh mechanism to ensure authentication validity
- The system uses secure password prompts by default

### Environment Variables
- Store sensitive data like SCMP_SHARE_ID in environment variables rather than in scripts
- Avoid storing passwords in environment variables; use secure token files instead

### Repository Security
- The `.deploy-service` and `.deploy-name` files are automatically added to `.gitignore` when created
- These files contain service identifiers that may be sensitive in some contexts

## Setup Instructions

1. Add bin directory to PATH:
```bash
export PATH="/Users/xin/auto-skills/bin:$PATH"
```

2. For SCMP functionality, set up your share ID:
```bash
export SCMP_SHARE_ID='<your-share-id>'
```

3. Log in to SCMP for the first time:
```bash
python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py login --prompt-password
```

4. For domain-tool-core, run install script if moving directories:
```bash
cd /Users/xin/auto-skills/domain-tool-core
node install.js
```

## Common Workflows

### New Service Setup:
1. Navigate to your service repository
2. Run `push` and enter the SCMP service name when prompted
3. This creates `.deploy-service` and `.deploy-name` files
4. Make changes to your code
5. Use `push -m "commit message"` to commit and push
6. Use `deploy` to deploy the service

### Domain Configuration:
1. Prepare Excel spreadsheet with domain configuration
2. Use domain-tool-core to generate JSON configuration
3. Review and adjust mappings as needed
4. Deploy using SCMP tools

### Regular Development Cycle:
1. Make code changes
2. Use `push -m "meaningful message"` to commit and push
3. Use `deploy` to deploy to your target environment
4. Monitor via notifications if configured

This documentation provides a comprehensive overview of the Auto-Skills project components and how to use them effectively.