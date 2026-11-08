NDI runtime for Church Presenter
================================

Put this ONE file in this folder:

    Processing.NDI.Lib.x64.dll

Where to get it (one time, on the computer you build the app on):
  1. Go to ndi.video -> For Developers -> download the free "NDI SDK" for Windows
     (you fill a short form, then download and install it).
  2. Copy  C:\Program Files\NDI\NDI 6 SDK\Bin\x64\Processing.NDI.Lib.x64.dll
     into this folder.

That's it. `npm start` will find it here, and `npm run dist` packs it into the
installer, so church PCs do NOT need NDI Tools installed - same as EasyWorship.

The NDI SDK licence allows shipping this DLL inside your app. Its conditions:
  - Show "NDI® is a registered trademark of Vizrt NDI AB" with a link to https://ndi.video
    (the app does this in Outputs -> NDI).
  - Ship the DLL unchanged.
  - Read the licence included with the SDK for the full terms.
