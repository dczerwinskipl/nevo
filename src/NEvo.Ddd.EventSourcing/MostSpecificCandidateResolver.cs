namespace NEvo.Ddd.EventSourcing;

/// <summary>
/// Deterministic most-specific-wins resolution among candidates already filtered to
/// "declaring type is assignable from the runtime aggregate type": the most-specific
/// compatible declaring type wins. Two or more candidates tied at the most-specific
/// level (including two candidates sharing the exact same declaring type) are ambiguous
/// and fail as a configuration/runtime error naming every tied candidate. Enumeration
/// order is never a tiebreaker.
/// </summary>
internal static class MostSpecificCandidateResolver
{
    public static Either<Exception, TCandidate> Resolve<TCandidate>(
        IReadOnlyCollection<TCandidate> candidates,
        Func<TCandidate, Type> declaringTypeSelector,
        Func<Exception> notFound,
        Func<IReadOnlyCollection<TCandidate>, Exception> ambiguous)
    {
        if (candidates.Count == 0)
        {
            return notFound();
        }

        var mostSpecific = candidates
            .Where(candidate => !candidates.Any(other =>
                !ReferenceEquals(other, candidate)
                && declaringTypeSelector(other) != declaringTypeSelector(candidate)
                && declaringTypeSelector(candidate).IsAssignableFrom(declaringTypeSelector(other))
            ))
            .ToList();

        return mostSpecific.Count == 1
            ? mostSpecific[0]
            : ambiguous(mostSpecific);
    }
}
