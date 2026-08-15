using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Authorization;

namespace NEvo.ExampleApp.Documents.Api.Authorization;

/// <summary>Permission identifiers recognized by the Documents example.</summary>
public static class DocumentPermissions
{
    public const string ApproveDocument = "APPROVE_DOCUMENT";
}

/// <summary>
/// The authorization data scope for document permissions. This example has no
/// per-request data to scope against, so it carries no fields — a single global
/// permission is enough.
/// </summary>
public record DocumentDataScope : AuthDataScope;

/// <summary>Validates the <see cref="DocumentPermissions.ApproveDocument"/> data scope. Always satisfied, since <see cref="DocumentDataScope"/> carries no scoping data.</summary>
public class ApproveDocumentPermissionValidator : IDataScopeMessageValidator<DocumentDataScope, ApproveDocument>
{
    public bool Validate(DocumentDataScope dataScope, ApproveDocument message) => true;
}

/// <summary>Maps the demo <see cref="ApproverRole"/> role to the permission <see cref="DocumentPermissions.ApproveDocument"/> requires.</summary>
public class ApproverPermissionMapper : IPermissionMapper<DocumentDataScope>
{
    public const string ApproverRole = "Approver";

    public bool CanMapRole(Role<DocumentDataScope> role) => role.Name == ApproverRole;

    public IEnumerable<IPermission> MapRole(Role<DocumentDataScope> role)
    {
        yield return new Permission<DocumentDataScope>(DocumentPermissions.ApproveDocument, new DocumentDataScope());
    }
}
