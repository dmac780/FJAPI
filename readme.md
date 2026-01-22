# Fake JSON API (FJAPI)

FJAPI is a serverless, browser-based query engine that allows for SQL-like interaction with static JSON files through URL query parameters. It transforms raw JSON files into a relational data source suitable for building public dashboards, custom data displays, or standalone database testing directly on GitHub Pages.

> **WARNING**: FJAPI is intended for development, testing, and production use with public data only. All files within the `/data/` directory are publicly accessible once deployed. **Do not store sensitive information, passwords, or private credentials in FJAPI or a Github repo.**

## Live Testing

You can test FJAPI immediately without installation by visiting the demo repository and appending query parameters to the URL:

**Demo URL**: [https://dmac780.github.io/FJAPI/](https://dmac780.github.io/FJAPI/)

**Example Test Queries**:
- [https://dmac780.github.io/FJAPI/?use=db&from=users](https://dmac780.github.io/FJAPI/?use=db&from=users)
- [https://dmac780.github.io/FJAPI/?use=db&from=posts&where=published=1](https://dmac780.github.io/FJAPI/?use=db&from=posts&where=published=1)
- [https://dmac780.github.io/FJAPI/?use=db&select=id,title,tags&from=posts&join=tags](https://dmac780.github.io/FJAPI/?use=db&select=id,title,tags&from=posts&join=tags)

## Database Schema Design

FJAPI uses a "Convention over Configuration" approach to handle relationships. To enable automatic joins, structure your JSON following these rules:

- **Plural Tables**: Root keys in your JSON should be plural (e.g., `posts`, `users`).
- **Primary Keys**: Every record must have an `id` field.
- **Foreign Keys**: Reference other tables using the singular name + `_id` (e.g., a post belongs to a user via `user_id`).
- **Pivot Tables**: For Many-to-Many relationships, name the table after both entities (e.g., `post_tags` to link `posts` and `tags`).

### Schema Example (`db.json`)
```json
{
  "users": [
    { "id": 1, "first_name": "Alice" }
  ],
  "posts": [
    { "id": 101, "title": "First Post", "user_id": 1 }
  ]
}
```

## Installation and Deployment

1. **Repository Setup**: Create a new GitHub repository.
2. **Data Structure**: Create a `/data/` directory and upload your JSON files (e.g., `db.json`).
3. **Entry Point**: Place `index.html` at the root. Include `app.js` via a `<script>` tag or inline the code.
4. **Hosting**: Enable GitHub Pages in the repository settings.
5. **Usage**: Visit your deployed GitHub Pages URL and append query parameters to explore and filter your data directly in the browser.

## Limitations

FJAPI is a **client-side only** application. Because the query engine runs entirely in the browser's JavaScript engine, the data cannot be fetched via standard `fetch()` or `curl` calls from other applications. 

When you request an FJAPI URL, you receive the `index.html` file. The data is only populated into the page after the browser executes `app.js`. For this reason, FJAPI is best used as a standalone data explorer, a live database reporting site, or a reference tool during development.

## Use Cases

While FJAPI cannot be consumed as a REST API for other apps, it is a powerful tool for:
- **Public Dashboards**: Create live, queryable views of public datasets.
- **Data Documentation**: Provide a way for users to explore and filter your project's data without needing a backend.
- **Static Site Database**: Use it as the primary data interface for standalone reporting tools hosted on GitHub Pages.
- **Mockup Validation**: Test complex relational queries against your schema using real data before building a full API.



## Query Parameters

| Parameter | Function | Example |
| :--- | :--- | :--- |
| **use** | Specifies the source filename in `/data/` | `?use=db` |
| **from** | Specifies the target array (table) | `&from=posts` |
| **select** | Field selection, aliasing, and counting | `&select=id=pid,COUNT__tags` |
| **join** | Relational mapping (HasOne, HasMany, Many2Many) | `&join=user,comments,tags` |
| **where** | Filtering (supports =, LIKE, IN, BETWEEN, AND, OR) | `&where=id BETWEEN 1,10` |
| **groupby** | Data pooling by field or joined field | `&groupby=user__role` |
| **having** | Conditional filtering on group counts | `&having=count > 1` |
| **count** | Returns record count with optional alias | `&count=1=total_rows` |
| **orderby** | Field to sort by (supports aggregation aliases) | `&orderby=id` |
| **sortby** | Sort direction (ASC or DESC) | `&sortby=DESC` |
| **limit** | Maximum records to return | `&limit=10` |
| **offset** | Number of records to skip | `&offset=20` |

## Query Cookbook

### 1. Basic Filtering
Different JSON files in the `/data/` directory act as independent databases. Use the `use` parameter to switch between them.

| Scenario | FJAPI Query |
| :--- | :--- |
| **Default Database** | `?use=db&from=users` |
| **Secondary Database** | `?use=auth&from=permissions` |
| **Filtered Selection** | `?use=db&select=id,title&from=posts&where=published=0` |
| **Range Filter (BETWEEN)** | `?use=db&from=posts&where=id BETWEEN 101,105` |
| **List Match (IN)** | `?use=db&from=users&where=id IN 1,2,3` |
| **Pattern Match (LIKE)** | `?use=db&from=users&where=first_name%20LIKE%20J$` |

### 2. Helpers and Aggregations
Utilities for shaping data and retrieving metadata.

| Scenario | FJAPI Query |
| :--- | :--- |
| **Distinct Values** | `?use=db&select=role&from=users&distinct=1` |
| **Simple Record Count** | `?use=db&from=posts&count=1=total_posts` |
| **Relational Count** | `?use=db&select=title,COUNT__tags=tag_count&from=posts&join=tags` |
| **Mathematical Sum** | `?use=db&select=SUM__id=total_id_score&from=posts` |

### 3. Relational Joins
Automatic discovery of BelongsTo, One-to-Many, and Many-to-Many relationships.

| Relationship | Query |
| :--- | :--- |
| **Belongs To** | `?use=db&from=posts&join=user` |
| **Many-to-Many** | `?use=db&select=id,title,tags&from=posts&join=tags` |
| **Direct Pivot** | `?use=db&select=tag__*&from=post_tags&where=post_id=101&join=tag` |

### 4. Advanced Analytics
Summarize data across table boundaries using grouping and logic.

| Operation | Query |
| :--- | :--- |
| **Grouped Count** | `?use=db&from=users&groupby=role&count=1=role_count` |
| **Role Summary** | `?use=db&select=SUM__COUNT__comments=total_comments&from=posts&join=user,comments&groupby=user__role` |
| **Filtered Groups** | `?use=db&from=comments&groupby=post_id&having=count>=3` |

## Complex Query Example

The following query identifies published posts, joins users and comments, groups by user role, calculates total comments and maximum comments per post within that role, filters for roles with multiple posts, and aliases the result count.

```text
?use=db&select=SUM__COUNT__comments=total_comments,MAX__COUNT__comments=max_comments_per_post&from=posts&join=user,comments&where=published=1&groupby=user__role&count=1=total_posts&having=count>1&orderby=total_comments&sortby=DESC
```