/** what a one-time emailed token may be used for (DECISIONS #135); internal, not part of the GraphQL schema */
export enum EmailTokenPurpose {
	VERIFY_EMAIL = 'VERIFY_EMAIL',
	/** the link sent to a NEW address; the old address stays in use until it is opened */
	CHANGE_EMAIL = 'CHANGE_EMAIL',
	RESET_PASSWORD = 'RESET_PASSWORD',
}
