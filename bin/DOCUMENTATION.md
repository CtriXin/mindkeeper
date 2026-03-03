# Global Scripts Documentation

This directory contains essential global scripts that are added to your PATH. These scripts provide enhanced functionality for deployment, git operations, and service management.

## Overview

The bin directory contains executable scripts that are globally accessible once added to your PATH. Each script serves a specific purpose in the development and deployment workflow, providing enhanced functionality beyond standard tools.

## Scripts Overview

### 1. `deploy` - Service Deployment
Primary command for deploying services through SCMP without browser UI.

### 2. `push` - Enhanced Git Push
Advanced git push workflow with version bumping, notifications, and hooks.

### 3. `lookup` - Service Lookup
Utility for looking up domain services and related information.

### 4. `claude-provider` - Claude Code Integration
Provider script for Claude Code integration.

### 5. `figmamcp` - Figma Integration
Script for Figma design system integration with SCMP.

## Setup

Add the bin directory to your shell PATH by adding this to your shell profile (e.g., `~/.zshrc`):

```bash
export PATH="/Users/xin/auto-skills/bin:$PATH"
```

Then reload your shell:
```bash
source ~/.zshrc
```

## Detailed Script Documentation

### deploy Script

The `deploy` script is the primary interface for service deployment through SCMP.

#### Functionality
- Wrapper around `scmp_cli.py` for simplified usage
- Automatic service name detection from repository
- Interactive deployment with intelligent defaults
- Daily token refresh for authentication

#### Usage
```bash
# Interactive mode - prompts for service name if not in repository
deploy

# Deploy specific service
deploy <service-name>

# Use flags (requires explicit service name)
deploy <service-name> --env prod --branch main
```

#### Repository Integration
The script looks for service names in order:
1. `.deploy-service` file (preferred)
2. `.deploy-name` file (legacy compatibility)

If in a git repository and no service name is provided, the script will attempt to read the service name from these files.

#### Options
- Automatically passes through all options to underlying `scmp_cli.py deploy` command

### push Script

The `push` script enhances the standard git push workflow with additional features.

#### Functionality
- Version bumping for branch names with semantic versioning
- Commit message prompting
- Optional Feishu notifications
- Pre/post hook execution
- Automatic repository configuration

#### Usage
```bash
# Interactive push with commit message prompt
push

# Push with commit message
push -m "feat: add new functionality"

# Push without notifications
push -m "fix: resolve issue" --no-notify

# Help
push -h
```

#### Version Bumping
The script supports two version formats:
1. **Standard (x.x.y)**: Suitable for simple versioning
2. **Extended (x.x.x.y)**: For more granular versioning

When pushing to a branch with version information, the script will:
- Detect existing version pattern in branch name
- Offer to increment the version
- Create a new branch with updated version

#### Notification System
The script supports Feishu notifications when environment variables are set:
- `FEISHU_WEBHOOK`: Webhook URL for notifications
- `PUSH_NOTIFY`: Set to 1 to enable auto-notifications

#### Hook System
The script supports pre/post hooks with the following search order:

**Pre-hooks:**
1. `$PUSH_LOCAL_HOOK` (environment variable)
2. `./.push.local.sh` (local file)
3. `./scripts/push.local.sh` (script directory)

**Post-hooks:**
1. `$PUSH_POST_HOOK` (environment variable)
2. `./.push.post.sh` (local file)
3. `./scripts/push.post.sh` (script directory)

Hooks receive these parameters:
- `$1`: Repository root path
- `$2`: Current branch name
- `$3`: Project name (repository basename)
- `$4`: Original branch name (before version bump)

#### Configuration Environment Variables
- `PUSH_NOTIFY`: Set to 1 for automatic notifications without prompting
- `PUSH_LOCAL_HOOK`: Path to pre-hook script
- `PUSH_POST_HOOK`: Path to post-hook script
- `PUSH_SKIP_BUMP`: Set to 1 to skip version bumping prompts

#### Repository Setup
When first run in a repository, the script will:
- Prompt for deployment name if `.deploy-service` doesn't exist
- Create both `.deploy-service` and `.deploy-name` files
- Add these files to `.gitignore` if the file exists
- Use repository basename as fallback deployment name

### lookup Script

The `lookup` script provides domain and service lookup capabilities.

#### Functionality
- Search for domain configurations and associated services
- Retrieve related information about deployed services
- Integration with domain-tool-core for configuration lookup

#### Usage
```bash
# Look up information for a domain or service
lookup <search-term>
```

### claude-provider Script

Integration script for Claude Code platform.

#### Functionality
- Provides Claude Code with necessary environment information
- Integrates with the auto-skills system
- Enables enhanced development workflows

### figmamcp Script

Figma integration script for connecting design systems with SCMP.

#### Functionality
- Syncs Figma design assets with SCMP
- Manages design token integration
- Provides Figma-to-code workflows

## Best Practices

### General Usage
- Always run these scripts from within a git repository when possible
- Use meaningful commit messages with conventional prefixes
- Configure appropriate notification settings for team awareness
- Leverage repository-specific configuration files

### Security Considerations
- Store sensitive tokens in secure locations
- Never commit sensitive information to version control
- Use environment variables for credentials where possible
- Regularly rotate authentication tokens

### Development Workflow
- Use `push` script for all git pushes to get version bumping and notifications
- Use `deploy` script for all deployments to ensure proper authentication
- Configure repository-specific settings for seamless integration
- Implement pre/post hooks for repository-specific workflows

## Troubleshooting

### Common Issues

#### Script not found
- Verify PATH includes `/Users/xin/auto-skills/bin`
- Check script has execute permissions (`chmod +x`)

#### Authentication failures
- Verify SCMP token is current
- Re-run authentication if needed
- Check token file permissions

#### Repository detection issues
- Ensure you're in the correct directory
- Verify `.deploy-service` or `.deploy-name` files exist
- Check git repository integrity

### Debugging
- Most scripts provide help with `-h` or `--help`
- Check script permissions if not executing properly
- Verify all dependencies are installed and accessible
## push Marker Extension (feature/ab)

`push` now supports optional release markers while remaining backward compatible.

### New CLI options
- `--feature <name>`: mark this push as a feature release
- `--ab <name>`: mark this push as an A/B release
- `--no-marker`: force marker mode to `none`
- `--dry-run`: print planned actions without commit/push/hook execution

### New environment variables
- `PUSH_FEATURE`
- `PUSH_AB`
- `PUSH_MARKER_MODE` (`none|feature|ab`)
- `PUSH_NON_INTERACTIVE=1` (skip marker prompts)

### Priority order
1. CLI args
2. Environment variables
3. Interactive selection
4. Default `none`

### Interactive behavior
When no marker is provided and not in non-interactive mode:
- `0. none` (default)
- `1. feature`
- `2. ab`

If marker is `feature`/`ab`, `push` will try to read options from:
- `scripts/push.options.json`

Format:
```json
{
  "feature": ["login-refactor", "seo-meta"],
  "ab": ["homehero", "payflow"]
}
```

`0) Manual input` is always available even if options exist.

### Hook context
Legacy hook args are unchanged:
- `$1 repo_root`
- `$2 current_branch`
- `$3 project_name`
- `$4 old_branch`

Additional exported context:
- `PUSH_FEATURE`
- `PUSH_AB`
- `PUSH_MARKER_MODE`
- `PUSH_CTX_JSON`
