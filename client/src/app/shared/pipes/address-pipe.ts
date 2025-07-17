import { Pipe, PipeTransform } from '@angular/core';
import { ShippingAddress } from '../models/order';

@Pipe({
  name: 'address'
})
export class AddressPipe implements PipeTransform {
  // Allow the value to be null
  transform(value?: ShippingAddress | null): string {
    if (value && 'line1' in value) {
      const { name, line1, line2, city, state, postalCode, country } = value;
      return `${name}, ${line1}${line2 ? ', ' + line2 : ''}, ${city}, ${state}, ${postalCode}, ${country}`;
    }
    return 'Unknown address';
  }
}