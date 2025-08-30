# Database MCP Server Example

A SQLite-based MCP server that provides database operations for creating, querying, and managing a local SQLite database.

## Features

- **SQLite Database**: Local database with no external dependencies
- **Safe SQL Operations**: Validated queries to prevent dangerous operations
- **Sample Data**: Pre-populated with example users and tasks tables
- **CRUD Operations**: Create, read, update, and delete data
- **Schema Management**: Create tables, describe structure, list tables

## Available Tools

### `query`
Execute a SELECT query on the database.

**Parameters:**
- `sql` (string): SELECT SQL query to execute

### `execute`
Execute an INSERT, UPDATE, or DELETE statement.

**Parameters:**
- `sql` (string): SQL statement to execute (INSERT, UPDATE, DELETE)

### `create_table`
Create a new table in the database.

**Parameters:**
- `table_name` (string): Name of the table to create
- `columns` (string): Column definitions (e.g., 'id INTEGER PRIMARY KEY, name TEXT')

### `list_tables`
List all tables in the database.

**Parameters:** None

### `describe_table`
Show the structure of a table.

**Parameters:**
- `table_name` (string): Name of the table to describe

### `insert_data`
Insert data into a table using key-value pairs.

**Parameters:**
- `table_name` (string): Name of the table
- `data` (object): Data to insert as key-value pairs

## Setup Instructions

1. **Install dependencies:**
   ```bash
   cd examples/database
   npm install
   ```

2. **Test the server:**
   ```bash
   npm start
   ```

3. **Configure in SpeakMCP:**
   Add this configuration to your MCP servers:
   ```json
   {
     "database-example": {
       "command": "node",
       "args": ["examples/database/index.js"],
       "env": {}
     }
   }
   ```

## Sample Data

The server automatically creates sample tables with data:

### Users Table
- id (INTEGER PRIMARY KEY)
- name (TEXT)
- email (TEXT UNIQUE)
- created_at (DATETIME)

### Tasks Table
- id (INTEGER PRIMARY KEY)
- title (TEXT)
- description (TEXT)
- completed (BOOLEAN)
- user_id (INTEGER, foreign key)
- created_at (DATETIME)

## Usage Examples

Once configured in SpeakMCP, you can use voice commands like:

- "Show me all users in the database"
- "Create a new task with title 'Buy groceries' for user 1"
- "List all incomplete tasks"
- "Update task 1 to mark it as completed"
- "Create a new table called products with columns id and name"
- "Show me the structure of the users table"

## Security Features

- **SQL Validation**: Only allows SELECT, INSERT, UPDATE, DELETE operations
- **Dangerous Keywords Blocked**: Prevents DROP, TRUNCATE, ALTER, PRAGMA
- **Table Name Validation**: Ensures safe table names
- **Parameterized Queries**: Prevents SQL injection for insert operations

## Sample Queries

### Basic Queries
```sql
SELECT * FROM users;
SELECT * FROM tasks WHERE completed = 0;
SELECT u.name, t.title FROM users u JOIN tasks t ON u.id = t.user_id;
```

### Data Modification
```sql
INSERT INTO users (name, email) VALUES ('Alice Johnson', 'alice@example.com');
UPDATE tasks SET completed = 1 WHERE id = 1;
DELETE FROM tasks WHERE completed = 1;
```

## Database File

The SQLite database file (`example.db`) is created in the same directory as the server script. This file persists data between server restarts.
