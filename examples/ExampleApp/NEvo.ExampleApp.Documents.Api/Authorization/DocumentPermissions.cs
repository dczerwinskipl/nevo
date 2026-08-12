using NEvo.Authorization;
using NEvo.Authorization.Permissions;
using NEvo.Authorization.Roles;
using NEvo.ExampleApp.Documents.Api.Domain;
using NEvo.Messaging.Authorization;

namespace NEvo.ExampleApp.Documents.Api.Authorization;

public static class DocumentPermissions
{
    public const string ApproveDocument = "APPROVE_DOCUMENT";
}

// No per-request data to scope against — a single global permission is enough for this
// compact example (contrast ServiceA.Api's SayDataScope, which scopes by company).
public record DocumentDataScope : AuthDataScope;

public class ApproveDocumentPermissionValidator : IDataScopeMessageValidator<DocumentDataScope, ApproveDocument>
{
    public bool Validate(DocumentDataScope dataScope, ApproveDocument message) => true;
}

// Maps the demo "Approver" role (see DemoRoleProvider) to the permission ApproveDocument
// requires.
public class ApproverPermissionMapper : IPermissionMapper<DocumentDataScope>
{
    public const string ApproverRole = "Approver";

    public bool CanMapRole(Role<DocumentDataScope> role) => role.Name == ApproverRole;

    public IEnumerable<IPermission> MapRole(Role<DocumentDataScope> role)
    {
        yield return new Permission<DocumentDataScope>(DocumentPermissions.ApproveDocument, new DocumentDataScope());
    }
}
