// APP_SECRET for key_mode 0 (files made without a passphrase). It ships inside the tool and is
// meant to be public: it only keeps the hidden part from showing at a glance. Use a passphrase
// to actually protect something. Changing it makes every key_mode 0 file made so far unreadable.
// The value is the UTF-8 bytes of "This is KONVERT's public secret." (32 bytes).

export const APP_SECRET_HEX = '54686973206973204b4f4e564552542773207075626c6963207365637265742e';
