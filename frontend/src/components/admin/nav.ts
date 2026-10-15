/** Moving between the admin page's tabs, e.g. from an account to one of its posts. Null goes back to the list. */
export interface AdminNav {
  openUser: (id: string | null) => void;
  openPost: (id: string | null) => void;
  openGroup: (id: string | null) => void;
}
