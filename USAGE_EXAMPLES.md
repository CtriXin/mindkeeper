# Usage Examples and Common Workflows

This document provides practical examples and step-by-step workflows for common tasks using the Auto-Skills project components.

## Prerequisites

Before using these workflows, ensure you have:

1. Added the bin directory to your PATH:
```bash
export PATH="/Users/xin/auto-skills/bin:$PATH"
```

2. For deployment operations, set up SCMP authentication:
```bash
export SCMP_SHARE_ID='<your-share-id>'
python3 scmp-deploy/scripts/scmp_cli.py login --prompt-password
```

## Common Workflows

### 1. New Service Setup and Deployment

**Step 1: Initialize a new service repository**
```bash
# Clone or create your service repository
git clone <service-repo-url>
cd <service-directory>

# The push script will prompt for deployment name on first run
push
# Enter your service name when prompted (this becomes your SCMP service name)
```

**Step 2: Make changes to your service**
```bash
# Create feature branch with versioning
git checkout -b feature-1.0.0

# Make your changes
# Edit files, add features, etc.
```

**Step 3: Commit and push with enhanced workflow**
```bash
# Use the enhanced push script with commit message
push -m "feat: add new feature for service"

# The script will:
# - Detect version in branch name and suggest increment (e.g., feature-1.0.0 → feature-1.0.1)
# - Stage all changes
# - Commit with your message
# - Push to remote
# - Optionally send notification
```

**Step 4: Deploy the service**
```bash
# Since you're in the service directory, deploy will use the name from .deploy-service
deploy

# Or specify service name explicitly
deploy <service-name>

# The deployment will:
# - Perform daily login if needed
# - Discover the service in SCMP
# - Find appropriate pipeline
# - Infer parameters from current deployment
# - Prompt for any missing parameters
# - Execute deployment
```

### 2. Domain Configuration Update

**Step 1: Prepare Excel configuration file**
- Create or update your Excel spreadsheet with domain configuration
- Include all necessary ad placement information
- Follow the column naming convention expected by your config mapping

**Step 2: Update your configuration mapping**
```bash
# Navigate to your domain configuration project
cd /path/to/your/domain/config

# If this is your first time, generate suggested config
node /path/to/domain-tool-core/index.js
# When prompted, enter 'y' to generate suggested-config.js
```

**Step 3: Review and update your config.js**
```javascript
// Update your config.js based on the suggested-config.js
// Use the new syntax: 'output_key': '${excel_column}'
module.exports = {
  adsMapping: {
    adsense: {
      'home_1': '${home_1}',
      'list_top': '${list_1}'
    },
    adx: {
      'list_top': '${list_1}',
      'categories[0]': '${list_2}',
      'categories[1]': '${list_3}'
    }
  }
};
```

**Step 4: Generate and preview configurations**
```bash
# Preview the output before committing
node /path/to/domain-tool-core/index.js --preview

# Review the preview-output.json file
cat preview-output.json
```

**Step 5: Commit and deploy configurations**
```bash
# Commit your configuration changes
push -m "feat: update ad configurations from latest Excel data"

# Deploy updated configurations (if deployment is needed)
deploy <config-service-name>
```

### 3. Troubleshooting and Diagnostics

**Check SCMP authentication status**
```bash
# Verify token is still valid
python3 scmp-deploy/scripts/scmp_cli.py service test --help

# If needed, refresh authentication
python3 scmp-deploy/scripts/scmp_cli.py login --prompt-password
```

**Debug deployment issues**
```bash
# Print the deployment payload before execution to verify parameters
deploy <service-name> --print-payload --env prod --branch main --version 1.0.0

# Or use individual commands for more granular debugging
python3 scmp-deploy/scripts/scmp_cli.py service <service-name>
python3 scmp-deploy/scripts/scmp_cli.py pipelines <service-name>
python3 scmp-deploy/scripts/scmp_cli.py current <service-name> <pipeline-name>
```

**Verify domain-tool-core connectivity**
```bash
# Ensure the anchor is properly set
node -e "console.log(require('/Users/xin/auto-skills/domain-tool-core'));" 2>/dev/null && echo "✓ Domain tool core accessible" || echo "✗ Domain tool core not accessible - run node install.js in core directory"
```

## Command Line Examples

### Deployment Examples

```bash
# Interactive deployment (recommended)
deploy

# Deploy with specific parameters
deploy my-service --env prod --branch main --version 1.2.3

# Deploy with minimal interaction (useful for scripts)
deploy my-service --env prod --no-interactive --branch release-1.0

# Deploy with dry-run-like output (shows payload without executing)
deploy my-service --print-payload
```

### Push Examples

```bash
# Standard push with interactive commit message
push

# Push with immediate commit message
push -m "fix: resolve critical bug in payment processing"

# Push without notifications (for quick fixes)
push -m "chore: update documentation" --no-notify

# Push with environment variable for notifications
export PUSH_NOTIFY=1
push -m "feat: implement new user authentication"

# Push without version bumping
export PUSH_SKIP_BUMP=1
push -m "docs: update API documentation"
```

### SCMP CLI Examples

```bash
# Direct SCMP operations (when you need fine-grained control)
python3 scmp-deploy/scripts/scmp_cli.py login --share-id "my-share" --prompt-password
python3 scmp-deploy/scripts/scmp_cli.py service my-service
python3 scmp-deploy/scripts/scmp_cli.py pipelines my-service --limit 5
python3 scmp-deploy/scripts/scmp_cli.py current my-service my-pipeline
python3 scmp-deploy/scripts/scmp_cli.py run my-service my-pipeline --payload '{"params": [{"name": "branch", "value": "main"}]}'
```

## Configuration File Examples

### Repository-Specific Deployment Configuration

**File: `.deploy-service`**
```
ptc-301-gb
```

**File: `.gitignore` additions**
```
# Deployment configuration
.deploy-service
.deploy-name
```

### Domain Configuration Example

**File: `config.js`**
```javascript
module.exports = {
  // Service name (if different from .deploy-service)
  serviceName: process.env.SERVICE_NAME || 'my-domain-service',

  // Ad mapping using new placeholder syntax
  adsMapping: {
    adsense: {
      'home_1': '${home_1}',
      'list_top': '${list_1}',
      'detail_sidebar': '${detail_side}'
    },
    adx: {
      'list_top': '${list_1}',
      'categories[0]': '${category_a}',
      'categories[1]': '${category_b}',
      'categories[2]': '${category_c}'
    }
  },

  // Optional: Custom ad templates
  adTemplate: './ads-template.js',

  // Additional configuration options
  features: {
    enableDynamicAds: true,
    fallbackAds: ['fallback-1', 'fallback-2']
  }
};
```

## Environment Setup Examples

### Shell Profile Configuration

**File: `~/.zshrc` or `~/.bash_profile`**
```bash
# Auto-skills project
export PATH="/Users/xin/auto-skills/bin:$PATH"

# SCMP Configuration
export SCMP_SHARE_ID='your-share-id-here'
# export SCMP_AUTHENTICATION='your-token-here'  # Alternative to token file

# Notification Configuration
export FEISHU_WEBHOOK='https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook-id'
export PUSH_NOTIFY=1  # Enable automatic notifications

# Development aliases
alias deploy-check='python3 /Users/xin/auto-skills/scmp-deploy/scripts/scmp_cli.py service test 2>/dev/null && echo "✓ SCMP connection OK" || echo "✗ SCMP connection failed"'
```

### Hook Script Examples

**File: `.push.local.sh` (pre-push hook)**
```bash
#!/bin/bash
# Parameters: $1=repo_root, $2=branch, $3=project_name, $4=old_branch

REPO_ROOT="$1"
BRANCH="$2"
PROJECT_NAME="$3"
OLD_BRANCH="$4"

echo "Running pre-push checks for $PROJECT_NAME..."

# Run linting
if command -v eslint >/dev/null 2>&1; then
    echo "Linting..."
    npx eslint . --ext .js,.jsx,.ts,.tsx || exit 1
fi

# Run tests
if command -v jest >/dev/null 2>&1; then
    echo "Running tests..."
    npm test || exit 1
fi

echo "Pre-push checks completed successfully!"
```

**File: `.push.post.sh` (post-push hook)**
```bash
#!/bin/bash
# Parameters: $1=repo_root, $2=branch, $3=project_name, $4=old_branch

REPO_ROOT="$1"
BRANCH="$2"
PROJECT_NAME="$3"
OLD_BRANCH="$4"

echo "Post-push actions for $PROJECT_NAME..."

# Trigger deployment if on main branch
if [ "$BRANCH" = "main" ]; then
    echo "Pushed to main, preparing for deployment..."
    # Add deployment preparation steps here
fi

echo "Post-push actions completed!"
```

## Troubleshooting Scenarios

### Scenario 1: "Cannot find domain-tool-core" Error

**Problem**: Components can't locate the domain-tool-core after moving the directory.

**Solution**:
```bash
cd /new/path/to/auto-skills/domain-tool-core
node install.js
```

### Scenario 2: Deployment Authentication Failure

**Problem**: Deployments fail with authentication errors.

**Solution**:
```bash
# Refresh token
python3 scmp-deploy/scripts/scmp_cli.py login --prompt-password
# Or check if token file permissions are correct
ls -la ~/.scmp_token.json
```

### Scenario 3: Incorrect Service Name Detection

**Problem**: Deploy uses wrong service name when run from repository.

**Solution**:
```bash
# Verify the .deploy-service file content
cat .deploy-service
# Correct if needed
echo "correct-service-name" > .deploy-service
```

### Scenario 4: Version Increment Issues

**Problem**: Branch version incrementing doesn't work as expected.

**Solution**:
```bash
# Check branch naming convention
git branch --show-current
# Use standard format (e.g., feature-1.2.3, release-2.1.0)
# Or skip version bumping
export PUSH_SKIP_BUMP=1
```

## Quick Reference Commands

| Purpose | Command |
|---------|---------|
| Deploy current repo | `deploy` (run in git repo with .deploy-service) |
| Deploy specific service | `deploy service-name` |
| Push with notifications | `push -m "message"` |
| Push without notifications | `push -m "message" --no-notify` |
| Check SCMP connection | `python3 scmp-deploy/scripts/scmp_cli.py service test` (will fail, but tests connection) |
| Regenerate config suggestions | `node /path/to/domain-tool-core/index.js` + 'y' when prompted |
| Refresh SCMP token | `python3 scmp-deploy/scripts/scmp_cli.py login --prompt-password` |

These examples and workflows cover the most common use cases for the Auto-Skills project components, providing a solid foundation for productive development and deployment workflows.