/// Convert a `.nixx` source string to valid Nix.
///
/// Transformations:
///   shell! { ... }            → shell '' ... ''
///   shell! [ deps ] { ... }   → mkShellTask { runtimeInputs = [...]; text = '' ... ''; }
///
/// Inside shell blocks:
///   ${VAR}     → ''${VAR}      (Nix indented-string escape)
///   ''         → '''           (same)
///   @nix(expr) → ${toString expr}  (explicit Nix interpolation)
pub fn convert(input: &str) -> Result<String, ConvertError> {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len());
    let mut i = 0;

    while i < chars.len() {
        match try_shell_block(&chars, i) {
            Some((converted, new_i)) => {
                output.push_str(&converted);
                i = new_i;
            }
            None => {
                output.push(chars[i]);
                i += 1;
            }
        }
    }

    Ok(output)
}

#[derive(Debug, PartialEq)]
pub struct ConvertError {
    pub message: String,
}

impl std::fmt::Display for ConvertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Try to parse and convert a `shell! ...` block starting at `start`.
/// Returns `(converted_string, position_after_block)` on success.
fn try_shell_block(chars: &[char], start: usize) -> Option<(String, usize)> {
    let keyword: &[char] = &['s', 'h', 'e', 'l', 'l', '!'];

    // "shell!" must appear at exactly this position
    if chars.get(start..start + keyword.len())? != keyword {
        return None;
    }

    // The char before "shell!" must not be an identifier char (prevent matching "myshell!")
    if start > 0 {
        let prev = chars[start - 1];
        if prev.is_alphanumeric() || prev == '_' {
            return None;
        }
    }

    let mut p = start + keyword.len();

    // Skip whitespace
    p += leading_whitespace(&chars[p..]);

    // Optional deps list: [ ... ]
    let deps = if chars.get(p) == Some(&'[') {
        p += 1;
        let (content, consumed) = extract_balanced(&chars[p..], ']')?;
        p += consumed;
        p += leading_whitespace(&chars[p..]);
        Some(content)
    } else {
        None
    };

    // Require opening {
    if chars.get(p) != Some(&'{') {
        return None;
    }
    p += 1;

    // Extract the shell body (everything up to the matching `}`)
    let (body, consumed) = extract_balanced(&chars[p..], '}')?;
    p += consumed;

    let transformed_body = transform_shell_content(&body);

    let result = match deps {
        Some(d) => format!(
            "mkShellTask {{\n  runtimeInputs = [ {} ];\n  text = ''{}'';\n}}",
            d.trim(),
            transformed_body
        ),
        None => format!("shell ''{}''", transformed_body),
    };

    Some((result, p))
}

/// Extract the balanced content up to `close` (handling `{}`/`[]`/`()`),
/// respecting single-quoted and double-quoted strings.
/// Returns `(content, chars_consumed_including_close)`.
fn extract_balanced(chars: &[char], close: char) -> Option<(String, usize)> {
    let open = match close {
        '}' => '{',
        ']' => '[',
        ')' => '(',
        _ => return None,
    };

    let mut depth = 1usize;
    let mut i = 0;
    let mut in_single = false;
    let mut in_double = false;

    while i < chars.len() {
        let ch = chars[i];

        if in_single {
            if ch == '\'' {
                in_single = false;
            }
        } else if in_double {
            if ch == '\\' {
                i += 1; // skip escaped char
            } else if ch == '"' {
                in_double = false;
            }
        } else {
            match ch {
                c if c == '\'' => in_single = true,
                c if c == '"' => in_double = true,
                c if c == open => depth += 1,
                c if c == close => {
                    depth -= 1;
                    if depth == 0 {
                        let content: String = chars[..i].iter().collect();
                        return Some((content, i + 1));
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }

    None // unterminated
}

/// Apply Nix indented-string escaping to shell block content.
fn transform_shell_content(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut result = String::new();
    let mut i = 0;

    while i < chars.len() {
        // @nix(expr) → ${toString expr}
        if starts_with_slice(&chars[i..], &['@', 'n', 'i', 'x', '(']) {
            i += 5;
            let expr_start = i;
            let mut depth = 1usize;
            while i < chars.len() {
                match chars[i] {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
            let expr: String = chars[expr_start..i].iter().collect();
            result.push_str("${toString ");
            result.push_str(&expr);
            result.push('}');
            if i < chars.len() {
                i += 1; // consume ')'
            }
            continue;
        }

        // '' → ''' (must check before ${ to avoid double-escaping)
        if i + 1 < chars.len() && chars[i] == '\'' && chars[i + 1] == '\'' {
            result.push_str("'''");
            i += 2;
            continue;
        }

        // ${ → ''${
        if i + 1 < chars.len() && chars[i] == '$' && chars[i + 1] == '{' {
            result.push_str("''${");
            i += 2;
            continue;
        }

        result.push(chars[i]);
        i += 1;
    }

    result
}

fn leading_whitespace(chars: &[char]) -> usize {
    chars.iter().take_while(|c| c.is_ascii_whitespace()).count()
}

fn starts_with_slice(haystack: &[char], needle: &[char]) -> bool {
    haystack.len() >= needle.len() && &haystack[..needle.len()] == needle
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_shell_block() {
        let input = "tasks.test = shell! {\n  cargo test\n};";
        let output = convert(input).unwrap();
        assert_eq!(output, "tasks.test = shell ''\n  cargo test\n'';");
    }

    #[test]
    fn escapes_dollar_brace() {
        let input = "x = shell! {\n  echo ${HOME}\n};";
        let output = convert(input).unwrap();
        assert_eq!(output, "x = shell ''\n  echo ''${HOME}\n'';");
    }

    #[test]
    fn plain_dollar_var_passes_through() {
        let input = "x = shell! {\n  echo $HOME\n};";
        let output = convert(input).unwrap();
        assert_eq!(output, "x = shell ''\n  echo $HOME\n'';");
    }

    #[test]
    fn escapes_double_single_quotes() {
        let input = "x = shell! {\n  echo ''\n};";
        let output = convert(input).unwrap();
        assert_eq!(output, "x = shell ''\n  echo '''\n'';");
    }

    #[test]
    fn nix_interpolation() {
        let input = "x = shell! {\n  echo @nix(port)\n};";
        let output = convert(input).unwrap();
        assert_eq!(output, "x = shell ''\n  echo ${toString port}\n'';");
    }

    #[test]
    fn nested_parens_in_nix_interp() {
        let input = "x = shell! {\n  echo @nix(lib.concatStrings [\"a\" \"b\"])\n};";
        let output = convert(input).unwrap();
        // lib.concatStrings uses [], not (), so depth tracking for parens works
        assert_eq!(
            output,
            "x = shell ''\n  echo ${toString lib.concatStrings [\"a\" \"b\"]}\n'';"
        );
    }

    #[test]
    fn with_deps() {
        let input = "run = shell! [ pkgs.cargo ] {\n  cargo test\n};";
        let output = convert(input).unwrap();
        assert_eq!(
            output,
            "run = mkShellTask {\n  runtimeInputs = [ pkgs.cargo ];\n  text = ''\n  cargo test\n'';\n};"
        );
    }

    #[test]
    fn multiple_blocks() {
        let input = "a = shell! {\n  foo\n};\nb = shell! {\n  bar\n};";
        let output = convert(input).unwrap();
        assert_eq!(output, "a = shell ''\n  foo\n'';\nb = shell ''\n  bar\n'';");
    }

    #[test]
    fn awk_braces_in_single_quotes_preserved() {
        // Single-quoted '{print $1}' in shell — the { and } are inside single quotes
        // so the scanner should not count them as block delimiters.
        let input = "x = shell! {\n  awk '{print $1}' file\n};";
        let output = convert(input).unwrap();
        // $1 has no {}, so no escaping. The '' wraps awk's arg.
        assert_eq!(output, "x = shell ''\n  awk '{print $1}' file\n'';");
    }

    #[test]
    fn does_not_match_myshell_bang() {
        let input = "myshell! { foo }";
        let output = convert(input).unwrap();
        assert_eq!(output, "myshell! { foo }"); // unchanged
    }

    #[test]
    fn passthrough_non_shell_content() {
        let input = "{ tasks.test = 42; }";
        let output = convert(input).unwrap();
        assert_eq!(output, "{ tasks.test = 42; }");
    }
}
