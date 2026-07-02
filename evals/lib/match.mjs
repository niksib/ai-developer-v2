/**
 * Minimal glob → RegExp for repo-relative POSIX paths. Supports `**` (any number
 * of path segments), `*` (within one segment), and literals. Mirrors the matcher
 * in the backend post-impl-checker so test/doc globs behave identically.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; }
        else re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** True if `file` matches any glob in `globs`. */
export function matchesAny(globs, file) {
  return (globs ?? []).some((g) => globToRegExp(g).test(file));
}
