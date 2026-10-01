# Publishing OmaBird

OmaBird is an independent MIT-licensed add-on and Omarchy shell plugin. It requires
an existing Betterbird installation; release packages do not contain Betterbird
binaries, source patches, logos or account data.

## License and branding

The project's own code and envelope icon are covered by the root MIT `LICENSE`.
The XPI includes this license. Preserve its copyright and permission notice when
redistributing OmaBird.

Betterbird's source and binaries are under MPL-2.0. Its repository also states
that applied Betterbird patches must be attributed in version-control changeset
headers or commit messages. If future work copies or changes MPL-covered files,
those files must keep the MPL terms and notices, and distributed binaries need
to provide access to their covered source. A new, separate file with no
MPL-covered code can use a different license; that is the intended structure here.

The MPL does not grant trademark rights. Betterbird identifies its red-orange
phoenix branding as trademarked. Use OmaBird's original icon and describe the
project as an **independent integration for Betterbird and Omarchy**. Avoid
claims of upstream sponsorship or approval. Dependencies retain their own
licenses; OmaBird's MIT license does not relicense them.

Primary references:

- [Betterbird's license and patch-attribution statement](https://github.com/Betterbird/thunderbird-patches/blob/main/LICENSE)
- [Mozilla's MPL FAQ, particularly Q11](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [MPL-2.0 text](https://www.mozilla.org/en-US/MPL/2.0/)
- [Betterbird branding statement](https://www.betterbird.eu/#colours)

## Repository and first release

1. Authenticate with `gh auth login` and create a GitHub repository for this
   checkout. Start privately if desired. The Omarchy marketplace needs a public
   repository, so make that visibility choice before submitting a listing.
2. Run the tests described in the README. Check the manifest and add-on versions
   match and commit the release source.
3. Package locally with `python3 omabird.py release`. This requires a clean Git
   checkout, builds the XPI, exports the committed source archive, validates the
   exported plugin (without development virtualenv files), and writes checksums.
4. Create a GitHub release for the corresponding tag and attach:
   `dist/omabird.xpi`, `dist/OmaBird-0.3.0.tar.gz`, and `dist/SHA256SUMS`.
5. In the release notes state: Omarchy Quattro is required, Betterbird 153 ESR
   was tested, the add-on uses a Thunderbird Experiment API, and installation
   requires both the helper/Omarchy plugin and the XPI.

Do not attach `.test-profile`, private status JSON, preferences, backups, logs or
virtualenvs. The checked-in popup preview uses fictional account labels and counts.

## Omarchy marketplace

The root `manifest.json` points to `shell-plugin/BarWidget.qml`, which lets
Omarchy discover the plugin from a cloned repository. Users can add the shell
plugin with:

```sh
omarchy plugin add https://github.com/OWNER/OmaBird.git --enable
```

Then run the helper installer from the cloned checkout:

```sh
python3 ~/.config/omarchy/plugins/local.omabird/omabird.py install
```

Finally, install its `dist/omabird.xpi` through Betterbird's Add-ons and Themes.
The bar will report counts as unavailable until the helper and add-on are ready.

Submit the repository link through the
[Omarchy publishing page](https://plugins.omarchy.org/publish.html). Its listing
requirements include a public repository, root manifest, README, license and
install/removal instructions. Listing validation is not a security review.

For a more discoverable plugin identifier, choose an author namespace before
publishing widely (the current installed ID is `local.omabird`). A rename should
include migration instructions for existing users.

## Optional Thunderbird add-on listing

The initial distribution can use GitHub release downloads and installation from
file. A later submission to [Thunderbird Add-ons](https://addons.thunderbird.net/)
needs its own compatibility testing and review. Do not advertise Thunderbird
support until tested independently of Betterbird.
