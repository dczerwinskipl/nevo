using LanguageExt;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// A test-only "always allow" IAggregateAuthorization stub, for tests that need to
// satisfy an IAggregateAuthorization<,,> dependency without exercising authorization
// itself. Production code has its own internal default (AllowAllAggregateAuthorization)
// — deliberately not a public dependency, so tests use their own stub instead of
// depending on it.
public class AlwaysAllowAuthorization<TCommand, TAggregate, TId> : IAggregateAuthorization<TCommand, TAggregate, TId>
    where TCommand : Command, IAggregateCommand<TAggregate, TId>
    where TAggregate : IAggregateRoot<TId>
    where TId : notnull
{
    public EitherAsync<Exception, Unit> AuthorizeAsync(TCommand command, Option<TAggregate> aggregate, IMessageContext context, CancellationToken cancellationToken)
        => Unit.Default;
}
