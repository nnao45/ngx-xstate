# Changesets

`@zstate/core` と `@zstate/ngx` は **fixed（ロック）** バージョニング。常に同一バージョンで publish される（Angular の `@angular/*` と同じ運用）。

変更を入れたら `pnpm changeset` で changeset を追加し、PR に含める。main へマージすると GitHub Actions が "Version Packages" PR を生成し、それをマージすると両 package が npm へ publish される。

詳しくは [the changesets docs](https://github.com/changesets/changesets) を参照。
