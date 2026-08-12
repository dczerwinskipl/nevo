using LanguageExt;
using NEvo.Ddd.EventSourcing;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Context;

namespace NEvo.ExampleApp.Documents.Api.Domain;

// Explicit Level 2 handler. The genuine orchestration need: the resulting event must
// record who approved the document, and a decision method (Level 1) has no way to know
// that — it only ever sees the command and the current aggregate state, never caller
// identity. The handler resolves the approver from the current-user context already
// populated by UserContextMiddleware for the message-level permission check on
// ApproveDocument (see DocumentCommands.cs), delegates the actual
// EditableDocument -> ApprovedDocument transition to Level 1's own decision method
// (EditableDocument.Approve) via IAggregateMethodDecider instead of duplicating it, and
// enriches the resulting event with the resolved approver.
public class ApproveDocumentHandler(IAggregateMethodDecider decider, IMessageContextAccessor contextAccessor)
    : IEventSourcedCommandHandler<ApproveDocument, Document, Guid>
{
    public EitherAsync<Exception, IEnumerable<IAggregateEvent<Document, Guid>>> HandleAsync(ApproveDocument command, Option<Document> aggregate, CancellationToken cancellationToken)
        => decider.DecideAsync(aggregate, command, cancellationToken)
            .Map(events => events.Select(WithResolvedApprover));

    private IAggregateEvent<Document, Guid> WithResolvedApprover(IAggregateEvent<Document, Guid> @event)
        => @event is DocumentApproved approved
            ? approved with { ApprovedBy = ResolveApprover() }
            : @event;

    private Guid ResolveApprover()
        => contextAccessor.MessageContext?.GetUserContext<Guid>().User.Map(user => user.Id).IfNone(Guid.Empty) ?? Guid.Empty;
}
