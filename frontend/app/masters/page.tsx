import { redirect } from 'next/navigation';

// Hub address for Masters. The material catalogue still lives at /oem.
export default function MastersHub() {
  redirect('/oem');
}
