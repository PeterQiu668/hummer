param(
  [Parameter(Mandatory = $true)]
  [string]$Title
)

$ErrorActionPreference = 'Stop'
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Drawing')

$form = [System.Windows.Forms.Form]::new()
$form.Name = 'FixtureWindow'
$form.Text = $Title
$form.Width = 540
$form.Height = 260
$form.StartPosition = 'CenterScreen'

$heading = [System.Windows.Forms.Label]::new()
$heading.Name = 'FixtureHeading'
$heading.Text = 'Synthetic UIAutomation fixture - no customer data'
$heading.AutoSize = $true
$heading.Location = [System.Drawing.Point]::new(24, 24)
$form.Controls.Add($heading)

$input = [System.Windows.Forms.TextBox]::new()
$input.Name = 'SafeInput'
$input.Text = 'synthetic-value'
$input.Width = 340
$input.Location = [System.Drawing.Point]::new(24, 70)
$form.Controls.Add($input)

$button = [System.Windows.Forms.Button]::new()
$button.Name = 'RunButton'
$button.Text = 'Run safe fixture'
$button.Width = 160
$button.Location = [System.Drawing.Point]::new(24, 116)
$form.Controls.Add($button)

$form.Show()
$form.Activate()
[System.Windows.Forms.Application]::Run($form)
