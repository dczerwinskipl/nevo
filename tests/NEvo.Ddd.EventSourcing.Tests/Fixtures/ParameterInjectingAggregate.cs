using LanguageExt;
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
