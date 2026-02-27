# Auto-Skills Project Comprehensive Documentation

## Project Overview
The Auto-Skills project is a comprehensive automation and deployment toolkit that combines domain configuration management with SCMP (Service Control Management Platform) deployment utilities. It provides developers with tools to manage domain configurations from Excel files and deploy services through automated workflows.

## Project Structure
```
auto-skills/
├── bin/                    # Executable scripts accessible via PATH
│   ├── deploy            # SCMP deployment wrapper
│   ├── push              # Enhanced git push workflow
│   ├── lookup            # Service/domain lookup utility
│   ├── claude-provider   # Claude Code integration
│   └── figmamcp          # Figma integration
├── scmp-deploy/          # SCMP deployment tools
│   ├── README.md
│   └── scripts/
│       ├── scmp_cli.py    # Main SCMP CLI interface
│       ├── scmp_api.py    # SCMP API wrapper
│       └── service_lookup.py # Service/domain lookup
├── domain-tool-core/     # Domain configuration engine
│   ├── index.js         # Main domain tool engine
│   ├── install.js       # Anchor installation script
│   ├── README.md
│   ├── MAINTENANCE.md
│   ├── DETAILED_DOCUMENTATION.md
│   ├── package.json
│   └── lib/             # Supporting libraries
├── backup/              # Backup configurations
└── .skills/             # Skill configurations
```

## Core Components

### 1. Domain Tool Core
**Location:** `/Users/xin/auto-skills/domain-tool-core/`

**Purpose:** Centralized engine for converting Excel spreadsheets into domain configuration JSON files.

**Key Features:**
- Excel-to-JSON conversion with smart column matching
- Advertising configuration mapping with placeholder syntax
- Template generation and configuration suggestions
- Preview mode for safe testing
- Global anchor system for cross-project access

**Configuration Syntax (v2.7.0+):**
```javascript
adsMapping: {
  adsense: {
    'home_1': '${home_1}',     // New placeholder syntax
    'list_top': '${list_1}'
  },
  adx: {
    'list_top': '${list_1}',
    'categories[0]': '${list_2}',  // Array element support
    'categories[1]': '${list_3}'
  }
}
```

**Usage:**
```bash
cd /path/to/domain-tool-core
node index.js  # Interactive mode
node index.js --preview  # Preview mode
```

### 2. SCMP Deployment Tools
**Location:** `/Users/xin/auto-skills/scmp-deploy/`

**Purpose:** Command-line tools for deploying services through SCMP without requiring a browser UI.

**Components:**
- **scmp_cli.py:** Main CLI interface with subcommands (login, service, pipelines, current, run, deploy)
- **service_lookup.py:** Service/domain lookup utility
- **scmp_api.py:** API wrapper for SCMP operations

**Security Model:**
- Never stores plaintext passwords
- Secure token storage with 0600 permissions
- Daily token refresh mechanism
- Hidden password input

### 3. Bin Scripts
**Location:** `/Users/xin/auto-skills/bin/`

**Purpose:** Globally accessible command-line utilities that integrate all components.

#### deploy
**Purpose:** Wrapper for SCMP CLI tool with automatic service name inference.
- Infers service name from `.deploy-service` or `.deploy-name` files
- Handles daily token refresh
- Interactive deployment workflow

**Usage:**
```bash
deploy                           # Interactive mode
deploy service-name              # Specific service
deploy service-name --env prod   # With parameters
```

#### push
**Purpose:** Enhanced git push with version bumping and notifications.
- Automatic version incrementation
- Commit message handling
- Optional Feishu notifications
- Pre/post hook support
- Automatic repository configuration

**Usage:**
```bash
push -m "commit message"         # With message
push --no-notify                 # Without notifications
push                             # Interactive mode
```

#### lookup
**Purpose:** Service/domain lookup utility.
- Finds service information by name or domain
- Resolves domains to service names using 'rf getcf'
- Provides Git URL and latest branch information

**Usage:**
```bash
lookup service-name              # Look up service
lookup domain.com                # Look up by domain
```

#### figmamcp
**Purpose:** Figma integration for SCMP.

#### claude-provider
**Purpose:** Claude Code integration for enhanced development workflows.

## Security Architecture

### Authentication
- **Tokens:** Stored with 0600 permissions
- **Passwords:** Never stored in plain text
- **Daily Refresh:** Automatic token renewal mechanism
- **Secure Input:** Hidden password prompts by default

### File Permissions
- Token files with restricted access (0600)
- Sensitive configuration files added to .gitignore
- Secure temporary file handling

### Environment Variables
- `SCMP_SHARE_ID`: Required for authentication
- `FEISHU_WEBHOOK`: Optional for notifications
- `PUSH_NOTIFY`: Optional for automatic notifications

## Workflows

### Development Workflow
1. Set up PATH: `export PATH="/Users/xin/auto-skills/bin:$PATH"`
2. Configure SCMP: `export SCMP_SHARE_ID='your-id'`
3. Authenticate: `python3 scmp-deploy/scripts/scmp_cli.py login --prompt-password`
4. In service repo, run `push` to set up `.deploy-service`
5. Make code changes
6. Use `push -m "message"` to commit and push
7. Use `deploy` to deploy to target environment

### Domain Configuration Workflow
1. Prepare Excel spreadsheet with domain data
2. Run `node index.js` in domain configuration project
3. Choose to generate `suggested-config.js` if needed
4. Update `config.js` with appropriate mappings
5. Use `--preview` flag to test before final generation
6. Deploy generated configurations

### Deployment Workflow
1. Prepare service code changes
2. Use `push` to commit and push with version bumping
3. Use `deploy` to deploy to production
4. Monitor via notifications if configured

## Global Anchor System

The domain-tool-core uses a global anchor system to enable cross-project access:

1. Creates anchor file at `~/.domain-tool-core-anchor`
2. Contains absolute path to the core directory
3. Allows moving the core directory without breaking references
4. Updated by running `node install.js`

## Integration Points

### Git Integration
- Automatic branch detection and versioning
- Repository-specific configuration files
- Push automation with notifications and hooks

### External Services
- SCMP for deployment orchestration
- Feishu for team notifications
- Figma for design system integration
- Excel for configuration data

### Local Environment
- PATH integration for global access
- Token file management
- Local anchor system for domain-tool-core

## Best Practices

### General Usage
- Always run scripts from within a git repository when possible
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

### Troubleshooting
- Verify PATH includes bin directory
- Check token validity for SCMP operations
- Confirm anchor file exists for domain-tool-core
- Use preview modes before production operations

## Error Handling and Recovery

### Common Issues
- **Token expiration:** Use daily login feature or refresh manually
- **Anchor not found:** Run `node install.js` in domain-tool-core directory
- **Service not found:** Verify service name and permissions
- **Parameter validation:** Backend may require additional parameters

### Recovery Procedures
1. Verify prerequisites (PATH, authentication, permissions)
2. Use individual commands to isolate problems
3. Check error messages for specific guidance
4. Refer to component-specific documentation

## Performance Considerations

### Domain Tool Core
- Process large Excel files in smaller chunks
- Use preview mode to validate before full processing
- Standardize Excel column naming for efficiency

### SCMP Tools
- Cache API responses where appropriate
- Use efficient parameter passing
- Implement retry logic for transient failures

### Git Operations
- Optimize hook execution times
- Use efficient version incrementation
- Minimize network requests during operations

This comprehensive documentation provides the foundation for understanding and using all components of the Auto-Skills project effectively.