# Homebrew formula for Veye
#
# Place this in your homebrew tap repository at:
#   Formula/veye.rb
# (e.g. https://github.com/veye/homebrew-tap/Formula/veye.rb)
#
# The url and sha256 values are replaced during the release process.
# Users install with: `brew install veye/tap/veye`

class Veye < Formula
  desc "Doc-freshness engine — measure, surface, and gate on documentation staleness"
  homepage "https://github.com/veye/veye"
  url "https://github.com/veye/veye/releases/download/v0.1.0/veye-darwin-arm64.tar.gz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"
  version "0.1.0"

  # Pre-built binary distribution — no build deps required
  depends_on :arch => :arm64

  def install
    bin.install "veye-darwin-arm64" => "veye"
  end

  test do
    assert_match "Veye", shell_output("#{bin}/veye --help")
  end
end
