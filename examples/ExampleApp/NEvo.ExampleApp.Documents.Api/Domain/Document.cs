using LanguageExt;
using NEvo.Ddd.EventSourcing;

namespace NEvo.ExampleApp.Documents.Api.Domain;

/// <summary>
/// A document aggregate root. Its concrete runtime type reflects the document's current
/// lifecycle state: <see cref="EditableDocument"/> before approval, <see
/// cref="ApprovedDocument"/> after.
/// </summary>
public abstract class Document(Guid id, string data) : IAggregateRoot<Guid>
{
    public Guid Id { get; } = id;
    public string Data { get; } = data;

    /// <summary>Decides document creation by emitting a <see cref="DocumentCreated"/> event.</summary>
    public static Either<Exception, IEnumerable<DocumentDomainEvent>> Create(CreateDocument command)
    {
        return new[] { new DocumentCreated(command.DocumentId, command.Data) };
    }

    /// <summary>Applies <see cref="DocumentCreated"/>, producing the document's initial state.</summary>
    public static Document Apply(DocumentCreated @event)
    {
        return new EditableDocument(@event.DocumentId, @event.Data);
    }
}

/// <summary>A document that has not yet been approved and can still be changed.</summary>
public sealed class EditableDocument(Guid id, string data) : Document(id, data)
{
    /// <summary>Decides a document data change by emitting a <see cref="DocumentChanged"/> event.</summary>
    public Either<Exception, IEnumerable<DocumentDomainEvent>> Change(ChangeDocument command)
    {
        return new[] { new DocumentChanged(Id, command.Data) };
    }

    /// <summary>Approves an editable document by emitting a <see cref="DocumentApproved"/> event.</summary>
    /// <remarks>
    /// Generates the approver identifier here (<see cref="Guid.NewGuid"/>) as a
    /// temporary placeholder: an aggregate-method convention decision method receives
    /// only the command and the current aggregate state, with no way to resolve the
    /// current caller. This should instead come from a current-user/context capability
    /// once one exists for decision methods to depend on — until then, this value is not
    /// a real identity.
    /// </remarks>
    public Either<Exception, IEnumerable<DocumentDomainEvent>> Approve(ApproveDocument command)
    {
        return new[] { new DocumentApproved(Id, ApprovedBy: Guid.NewGuid()) };
    }

    /// <summary>Applies <see cref="DocumentChanged"/>, returning the updated state.</summary>
    public EditableDocument Apply(DocumentChanged @event)
        => new(Id, @event.Data);

    /// <summary>Applies <see cref="DocumentApproved"/>, transitioning to <see cref="ApprovedDocument"/>.</summary>
    public ApprovedDocument Apply(DocumentApproved @event)
        => new(Id, Data, @event.ApprovedBy);
}

/// <summary>A document that has been approved.</summary>
public sealed class ApprovedDocument(Guid id, string data, Guid approvedBy) : Document(id, data)
{
    public Guid ApprovedBy { get; } = approvedBy;
}
