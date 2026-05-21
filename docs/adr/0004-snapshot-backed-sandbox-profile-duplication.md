# Snapshot-Backed Sandbox Profile Duplication

Sandbox profile duplication requires the source profile's active published configuration to have a usable Snapshot, and creates the duplicate from that configuration and Snapshot rather than rebuilding from the Setup script. The duplicate starts with the copied published configuration as active v1, may carry the source profile's Latest saved draft as a separate draft version, and performs optional trigger copying in the same atomic operation so invalid references or trigger capabilities fail the duplicate before partial objects are created.

This favors immediate usability and faithful operational copying over configuration-only duplication or a fresh snapshot rebuild. Automatic snapshot refresh can therefore be copied as active execution state with fresh schedule timing, while copied triggers remain disabled to avoid creating duplicate live automation streams.
