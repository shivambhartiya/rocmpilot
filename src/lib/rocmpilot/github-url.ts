export type GitHubRepoRef = {
  owner: string;
  repo: string;
  branch?: string;
  repoUrl: string;
  label: string;
};

export function parseGitHubRepoUrl(input: string | undefined): GitHubRepoRef | null {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input.trim());

    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }

    const [owner, repoWithSuffix, maybeTree, ...rest] = url.pathname
      .split("/")
      .filter(Boolean);
    const repo = repoWithSuffix?.replace(/\.git$/, "");

    if (!owner || !repo) {
      return null;
    }

    const branch = maybeTree === "tree" && rest.length > 0 ? rest.join("/") : undefined;

    return {
      owner,
      repo,
      branch,
      repoUrl: `https://github.com/${owner}/${repo}${branch ? `/tree/${branch}` : ""}`,
      label: `${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

export function isRealGitHubRepoUrl(input: string | undefined) {
  const repo = parseGitHubRepoUrl(input);
  return Boolean(repo && repo.owner !== "example");
}
