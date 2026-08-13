using LanguageExt;
using NEvo.Authorization.Users;
using NEvo.Messaging.Authorization;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Events;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// A scoped-lifetime dependency used to prove decision-method parameter resolution reads
// the current invocation's DI scope, not a value captured once at discovery/startup
// time — each DI scope produces a different Guid.
public interface IParameterInjectionDependency
{
    Guid Value { get; }
}

public class ParameterInjectionDependency : IParameterInjectionDependency
{
    public Guid Value { get; } = Guid.NewGuid();
}

// Deliberately never registered in DI — used only to prove an unresolvable additional
// parameter fails clearly, naming the method and the parameter type.
public interface IUnregisteredParameterInjectionDependency
{
}

// Registered via a factory that always throws — proves an exception raised while
// resolving/activating a parameter (not merely "unregistered") is caught and
// represented as the same typed resolution failure, never escaping uncontrolled.
public interface IActivationThrowingDependency
{
}

public class ParameterInjectingAggregate(Guid id) : IAggregateRoot<Guid>
{
    public Guid Id { get; set; } = id;
    public Guid ResolvedDependencyValue { get; set; }

    public static Either<Exception, IEnumerable<ParameterInjectingAggregateDomainEvent>> Create(CreateParameterInjectingAggregate command, IParameterInjectionDependency dependency)
        => new[] { new ParameterInjectingAggregateCreated(command.ParameterInjectingAggregateId, dependency.Value) };

    public static ParameterInjectingAggregate Apply(ParameterInjectingAggregateCreated @event)
        => new(@event.ParameterInjectingAggregateId) { ResolvedDependencyValue = @event.ResolvedDependencyValue };

    public Either<Exception, IEnumerable<ParameterInjectingAggregateDomainEvent>> Mutate(MutateParameterInjectingAggregate command, IParameterInjectionDependency dependency)
        => new[] { new ParameterInjectingAggregateMutated(Id, dependency.Value) };

    public Either<Exception, IEnumerable<ParameterInjectingAggregateDomainEvent>> MutateWithUnresolvedDependency(MutateParameterInjectingAggregateWithUnresolvedDependency command, IUnregisteredParameterInjectionDependency dependency)
        => new[] { new ParameterInjectingAggregateMutated(Id, Guid.Empty) };

    public Either<Exception, IEnumerable<ParameterInjectingAggregateDomainEvent>> MutateWithActivationThrowingDependency(MutateParameterInjectingAggregateWithActivationThrowingDependency command, IActivationThrowingDependency dependency)
        => new[] { new ParameterInjectingAggregateMutated(Id, Guid.Empty) };

    // ICurrentUser<,> is the concrete, real-world stand-in for a required contextual
    // capability that resolves as a type but has no current value for this invocation
    // (D44). The invocation counter proves the decision method's body is never entered
    // when CurrentUser<,> fails during its own construction/activation.
    public int MutateWithCurrentUserInvocationCount { get; private set; }

    public Either<Exception, IEnumerable<ParameterInjectingAggregateDomainEvent>> MutateWithCurrentUser(MutateParameterInjectingAggregateWithCurrentUser command, ICurrentUser<Guid, User<Guid>> currentUser)
    {
        MutateWithCurrentUserInvocationCount++;
        return new[] { new ParameterInjectingAggregateMutated(Id, currentUser.User.Id) };
    }

    public ParameterInjectingAggregate Apply(ParameterInjectingAggregateMutated @event)
    {
        ResolvedDependencyValue = @event.ResolvedDependencyValue;
        return this;
    }
}

public record ParameterInjectingAggregateCommand(Guid ParameterInjectingAggregateId) : Command, IAggregateCommand<ParameterInjectingAggregate, Guid>
{
    public Guid StreamId => ParameterInjectingAggregateId;
}

public record CreateParameterInjectingAggregate(Guid ParameterInjectingAggregateId) : ParameterInjectingAggregateCommand(ParameterInjectingAggregateId);
public record MutateParameterInjectingAggregate(Guid ParameterInjectingAggregateId) : ParameterInjectingAggregateCommand(ParameterInjectingAggregateId);
public record MutateParameterInjectingAggregateWithUnresolvedDependency(Guid ParameterInjectingAggregateId) : ParameterInjectingAggregateCommand(ParameterInjectingAggregateId);
public record MutateParameterInjectingAggregateWithActivationThrowingDependency(Guid ParameterInjectingAggregateId) : ParameterInjectingAggregateCommand(ParameterInjectingAggregateId);
public record MutateParameterInjectingAggregateWithCurrentUser(Guid ParameterInjectingAggregateId) : ParameterInjectingAggregateCommand(ParameterInjectingAggregateId);

public abstract record ParameterInjectingAggregateDomainEvent(Guid ParameterInjectingAggregateId) : Event, IAggregateEvent<ParameterInjectingAggregate, Guid>
{
    public Guid StreamId => ParameterInjectingAggregateId;
}

public record ParameterInjectingAggregateCreated(Guid ParameterInjectingAggregateId, Guid ResolvedDependencyValue) : ParameterInjectingAggregateDomainEvent(ParameterInjectingAggregateId);
public record ParameterInjectingAggregateMutated(Guid ParameterInjectingAggregateId, Guid ResolvedDependencyValue) : ParameterInjectingAggregateDomainEvent(ParameterInjectingAggregateId);

// A deliberately misconfigured aggregate: its decision method declares a command-typed
// parameter that is not first — used only to prove AggregateDeciderExtractor rejects
// this at discovery time with a specific, actionable error, distinct from "not a
// decider at all".
public class MisplacedCommandParameterAggregate(Guid id) : IAggregateRoot<Guid>
{
    public Guid Id { get; set; } = id;

    public static Either<Exception, IEnumerable<MisplacedCommandParameterAggregateCreated>> Create(IParameterInjectionDependency dependency, CreateMisplacedCommandParameterAggregate command)
        => new[] { new MisplacedCommandParameterAggregateCreated(command.MisplacedCommandParameterAggregateId) };
}

public record MisplacedCommandParameterAggregateCommand(Guid MisplacedCommandParameterAggregateId) : Command, IAggregateCommand<MisplacedCommandParameterAggregate, Guid>
{
    public Guid StreamId => MisplacedCommandParameterAggregateId;
}

public record CreateMisplacedCommandParameterAggregate(Guid MisplacedCommandParameterAggregateId) : MisplacedCommandParameterAggregateCommand(MisplacedCommandParameterAggregateId);

public record MisplacedCommandParameterAggregateCreated(Guid StreamId) : Event, IAggregateEvent<MisplacedCommandParameterAggregate, Guid>;
