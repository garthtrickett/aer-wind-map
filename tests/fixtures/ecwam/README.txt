november-2025-taiwan.nc: 720 actual hourly UTC observations of model output,
extracted from ECMWF research experiment iocj (CY50R1 ECWAM hindcast),
November 2025. Six packed NetCDF3 swell fields, original units and packing.
Output cell 23.25N, 122.5E from the original 0.25-degree validation extraction.
This is a parser fixture, not the application's 0.125-degree cache.
Source: https://apps.ecmwf.int/ifs-experiments/rd/iocj/ (CC BY 4.0).

november-2025-record-padding.nc: regression fixture with an unlimited time
axis and 3x3 spatial grid of packed 16-bit variables. Each hourly record has
9 cells plus two bytes of NetCDF alignment padding. It repeats the real
validation-cell values above across the synthetic spatial grid. It is NOT
independent fine-grid model output. The fixture tests removal of per-record
padding, rather than stripping only the final array tail.
