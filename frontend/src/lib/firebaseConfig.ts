/**
 * ProMic's Firebase project, which ExiThreat uses for confirming mobile numbers
 * (firebasePhone.ts) and for admins' sign-in to the admin page (adminAuth.ts). These are the
 * project's public web settings (the same as ProMic's admin panel), not secrets. The site's
 * domain must be listed under Authentication → Settings → Authorized domains in the Firebase
 * console.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyD3OmePJ_LlaT7B1I4HPqT9N3QglxnjD9k',
  authDomain: 'promic-c5567.firebaseapp.com',
  projectId: 'promic-c5567',
  appId: '1:945516079425:web:c7e31f3fc5c889b4b5d9c0',
};
