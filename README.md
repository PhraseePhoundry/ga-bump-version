# ga-bump-version

This repository contains a GitHub Action for carrying out an automated npm version bump. The action bumps the version in `package.json` and pushes it back to the repo as a new commit. This repository was originally a fork of [`phips28/gh-action-bump-version`](https://github.com/phips28/gh-action-bump-version). 

> ❗ Important note: this repository is **public**, as is required by GitHub when working with reusable actions and workflows. Care should be taken when committing or reviewing code in this respository to ensure sensitive information is not leaked.


# Usage

## Inputs

This action uses git commit messages to determine how to update the semantic version number.

If a commit uses the phrase "SET VERSION NUMBER {xx.xx.xx}", the semantic version will be updated in its entirety to match the version number specified.
```
git commit -m "This is a commit to SET VERSION NUMBER {2.4.12}"
1.0.0 ==> 2.4.12
```

If a commit uses the words/phrases "MAJOR VERSION INCREMENT", "major", or "breaking change", the _major_ version will be incremented.
```
git commit -m "This is a commit containing a breaking change"
2.4.12 ==> 3.4.12
```

If a commit uses the words/phrases "MINOR VERSION INCREMENT", "new feature", "minor", the _minor_ version will be incremented.
```
git commit -m "This is a commit containing a new feature"
3.4.12 ==> 3.5.12
```

If a commit contains none of the above keywords/phrases, the _patch_ version will be incremented.
```
git commit -m "This is a normal commit message"
3.5.12 ==> 3.5.13
```

## Outputs

This action updates the `package.json` for the repo with the new version number, and pushes a new commit. The action also explicitly outputs the new incremented version number, for use by other actions in a workflow.