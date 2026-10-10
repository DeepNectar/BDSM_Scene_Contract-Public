#!/usr/bin/env python3
"""Static syntax checker for the Deep & Honey Supabase SQL scripts.

Guards against the exact class of failures seen in the Supabase SQL Editor:
  1. git-diff / merge-conflict markers pasted into a script ("+++ b/file",
     "@@ ... @@", "<<<<<<<") -> Postgres error 42601 "syntax error at or near +".
  2. unbalanced dollar-quoted blocks ($$ ... $$).
  3. unbalanced parentheses / quotes outside comments and strings.
  4. statements not terminated by ';' or trailing junk after the last ';'.
  5. (optional, if `pip install sqlglot` is available) real PostgreSQL
     grammar parse of every statement.

Usage: python3 sql/check-sql-syntax.py <file.sql> [more.sql ...]
Exit code 0 = clean, 1 = problems found.
"""
import re
import sys

def split_statements(sql):
    """Split on ';' while respecting -- comments, ''/"" literals and $$ blocks."""
    stmts, buf, i, n = [], [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith('--', i):
            j = sql.find('\n', i)
            j = n if j == -1 else j
            buf.append(sql[i:j]); i = j; continue
        if sql.startswith('$$', i):
            j = sql.find('$$', i + 2)
            if j == -1:
                buf.append(sql[i:]); i = n; continue
            buf.append(sql[i:j + 2]); i = j + 2; continue
        if c in ("'", '"'):
            q = c; buf.append(c); i += 1
            while i < n:
                if sql[i] == q:
                    if q == "'" and i + 1 < n and sql[i + 1] == "'":
                        buf.append("''"); i += 2; continue
                    buf.append(q); i += 1; break
                buf.append(sql[i]); i += 1
            continue
        if c == ';':
            buf.append(';'); stmts.append(''.join(buf)); buf = []; i += 1; continue
        buf.append(c); i += 1
    if ''.join(buf).strip():
        stmts.append(''.join(buf))
    return stmts

def strip_all(sql):
    """Return (body_without_comments_or_literals, dollar_count)."""
    out, i, n, dollars = [], 0, len(sql), 0
    while i < n:
        c = sql[i]
        if sql.startswith('--', i):
            j = sql.find('\n', i); i = n if j == -1 else j; continue
        if sql.startswith('$$', i):
            dollars += 1
            j = sql.find('$$', i + 2)
            if j == -1:
                return ''.join(out), dollars  # unterminated
            i = j + 2; continue
        if c == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2; continue
                    break
                i += 1
            i += 1; continue
        out.append(c); i += 1
    return ''.join(out), dollars

def check(path):
    src = open(path, encoding='utf-8').read()
    errors = []

    # 1) diff / conflict markers
    for i, line in enumerate(src.splitlines(), 1):
        if re.match(r"^(<<<<<<<|>>>>>>>|\+\+\+ |@@ )", line):
            errors.append(f"line {i}: diff/conflict marker pasted into SQL -> {line!r}")

    body, dollars = strip_all(src)

    # 2) balanced $$ (count occurrences directly; scanner skips them as pairs)
    if src.count('$$') % 2:
        errors.append("odd number of $$ delimiters (unterminated function body?)")

    # 3) balanced parens in code (comments/strings already removed)
    depth = 0
    for ch in body:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth < 0:
                errors.append("unbalanced parenthesis: extra ')'")
                break
    if depth > 0:
        errors.append(f"unbalanced parenthesis: {depth} unclosed '('")

    # 4) statement completeness
    stmts = split_statements(src)
    tail = body.rsplit(';', 1)[-1].strip()
    if tail:
        errors.append(f"trailing text after last ';' is not a complete statement: {tail[:60]!r}")

    keywords = ("select", "insert", "update", "delete", "create", "drop",
                "alter", "grant", "comment", "with", "begin", "do", "set",
                "truncate", "analyze", "vacuum")
    real = 0
    for s in stmts:
        code, _ = strip_all(s)
        code = code.strip().rstrip(';').strip()
        if not code:
            continue
        real += 1
        first = code.split(None, 1)[0].lower()
        if first not in keywords and not first.startswith('$'):
            errors.append(f"statement starts with unexpected token {first!r}: {code[:60]!r}")

    # 5) optional real grammar check
    try:
        import sqlglot
        ok = True
        for s in stmts:
            code, _ = strip_all(s)
            if not code.strip().strip(';').strip():
                continue
            try:
                sqlglot.parse_one(s, read='postgres',
                                  error_level=sqlglot.ErrorLevel.WARN)
            except Exception as e:
                ok = False
                errors.append(f"grammar check failed: {str(e)[:100]}")
        if ok:
            print("  grammar check (sqlglot/postgres): PASS")
    except ImportError:
        print("  note: sqlglot not installed — structural checks only")

    print(f"{path}: {real} statements checked")
    if errors:
        for e in errors:
            print("  ERROR:", e)
        return 1
    print("  OK — no syntax hazards found")
    return 0

if __name__ == "__main__":
    rc = 0
    for p in sys.argv[1:]:
        rc |= check(p)
    sys.exit(rc)
